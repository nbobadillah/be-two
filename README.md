# be-two

Este repositorio quedó ajustado a la actividad del `GUIDE.md`: se completó el módulo `bikes` y este `README.md` responde las preguntas de `TASKS.md` leyendo el código del proyecto.

## Respuestas

### 1. Duplicados con `McQueen` y `mcqueen`

Sí, en esta aplicación terminan siendo duplicados. La línea que define ese comportamiento es:

```ts
createCarDto.nombre = createCarDto.nombre.toLowerCase();
```

Está en el método `create` de `src/cars/cars.service.ts`. Esa línea convierte cualquier valor de `nombre` a minúsculas antes de guardarlo. Entonces `"McQueen"` se almacena como `"mcqueen"` y el segundo insert también intenta guardar `"mcqueen"`. Como `nombre` tiene `@Prop({ unique: true, index: true })` en `src/cars/entities/car.entity.ts`, el segundo insert viola el índice único y MongoDB devuelve el error `11000`.

La consecuencia práctica es que la unicidad de `nombre` se vuelve efectivamente case-insensitive desde la aplicación, no porque el índice único por sí mismo compare sin distinguir mayúsculas, sino porque el servicio normaliza todos los valores antes de escribirlos.

### 2. Por qué existen las dos validaciones del id

Existen porque están protegiendo dos flujos distintos:

- `findOne` valida dentro del servicio, porque el endpoint `GET /cars/:id` no usa `ParseMongoIdPipe`.
- `remove` valida en el controlador con `@Param('id', ParseMongoIdPipe)`, así que el servicio recibe solo ids con formato válido.

Si `findOne` no tuviera `isValidObjectId(id)` y recibiera `"abc"`, el valor llegaría a `this.carsModel.findById(id)`. Esa operación dispara un `CastError` de Mongoose por intentar convertir `"abc"` a `ObjectId`. Como `findOne` no tiene un `try/catch` que transforme ese error en una excepción HTTP controlada, el cliente terminaría recibiendo `500 Internal Server Error`.

Si `remove` no usara `ParseMongoIdPipe` y recibiera `"abc"`, el id inválido llegaría hasta `this.carsModel.deleteOne({ _id: id })`. En ese caso Mongoose también lanza un `CastError`, así que el cliente volvería a recibir `500 Internal Server Error`.

Entonces, en esos dos escenarios hipotéticos el resultado sería el mismo: `500`. La diferencia real entre las dos validaciones no es el status en ese caso, sino el punto del ciclo de vida donde frenan la petición. Con el código actual, `findOne` devuelve `400` desde el servicio y `remove` devuelve `400` desde el pipe, antes de que el controlador se ejecute.

### 3. Por qué `create` usa `try/catch` y `findAll` no

`create` sí necesita `try/catch` porque hace una escritura y puede disparar errores de base de datos asociados a restricciones, en particular el error `11000` por duplicado en un campo `unique`. `findAll` solo hace lectura con `this.carsModel.find()`, así que nunca va a producir un error de clave duplicada.

El `try/catch` de `create` existe para delegar en `handleException(error)`, que convierte `11000` en:

- `BadRequestException`
- HTTP `400`

Si se quitara el `try/catch` de `create` y MongoDB lanzara `11000`, el error subiría sin transformarse y Nest lo trataría como un error no controlado. El cliente recibiría `500 Internal Server Error`, no `400`.

### 4. Cuántas consultas hace `update` y si la respuesta puede diferir

En el camino feliz hace 2 consultas a la base de datos:

1. `this.findOne(id)` hace el `findById`.
2. `bike.updateOne(...)` o `car.updateOne(...)` hace el `update`.

No hace una tercera lectura, porque en vez de volver a consultar usa:

```ts
return { ...car.toJSON(), ...updateCarDto };
```

Sí, la respuesta de la API puede diferir de lo que realmente quedó en MongoDB, porque la respuesta mezcla un snapshot viejo del documento con el DTO enviado, en vez de releer el documento actualizado.

Un caso concreto: entre el `findOne(id)` y el `updateOne(...)`, otra petición actualiza `modelo`. La base puede quedar con el `modelo` nuevo de la otra petición, pero esta respuesta seguiría devolviendo el `modelo` viejo tomado de `car.toJSON()`.

### 5. Problema de usar `forRoot(process.env.MONGODB_URL || ...)`

El problema es el momento de evaluación. En esta versión:

```ts
MongooseModule.forRoot(process.env.MONGODB_URL || 'mongodb://localhost:27017/nest-cars')
```

JavaScript evalúa `process.env.MONGODB_URL` inmediatamente cuando se carga `app.module.ts` y se construye el metadata object del decorador `@Module`. En ese punto todavía no necesariamente corrió `ConfigModule.forRoot({ isGlobal: true })`, así que `.env` puede no haberse cargado aún.

La consecuencia es que `process.env.MONGODB_URL` podría venir como `undefined` y terminar usando el fallback local aunque sí exista un valor correcto en `.env`.

`forRootAsync({ useFactory })` lo resuelve porque retrasa la creación de la configuración de Mongoose hasta que Nest inicializa los módulos en orden. Primero se carga `ConfigModule`; después se ejecuta la `factory`; ahí sí `process.env.MONGODB_URL` ya está disponible.

### 6. Qué pasa si falta `CarsModule` o `forFeature`

Si un estudiante olvida importar `CarsModule` en `AppModule`, la aplicación puede arrancar sin error. El problema aparece cuando alguien intenta usar rutas como `/api/cars`: esas rutas no existen en la app y el cliente recibiría `404 Not Found`. No hay error de startup porque ni el controlador ni el servicio de `cars` fueron registrados.

Si otro estudiante sí importa `CarsModule` en `AppModule` pero olvida `MongooseModule.forFeature(...)` dentro de `src/cars/cars.module.ts`, ahí sí hay error de arranque. `CarsService` pide `@InjectModel(Car.name)`, pero Nest no encuentra ese provider. El error es de inyección de dependencias del modelo de `Car` y se diagnostica primero mirando `src/cars/cars.module.ts`, porque ahí es donde debía registrarse el schema.

### 7. Ventaja de usar `deleteOne` directo

La ventaja es que elimina en una sola consulta. Si primero hiciera `findOne(id)` y luego borrara, serían dos viajes a la base de datos, más latencia y una ventana de carrera innecesaria entre “encontré el documento” y “ahora lo borro”.

Aunque `ParseMongoIdPipe` garantiza que el formato del id es válido, `deletedCount` todavía puede ser `0` cuando el id tiene forma válida de ObjectId pero no existe ningún documento con ese `_id` en la colección.

### 8. Qué se pierde si la validación del pipe se mueve al servicio

Se pierde una ventaja arquitectónica clara: validación reutilizable y desacoplada en la capa de entrada HTTP. El pipe deja el controlador limpio y corta la petición antes de que llegue a la lógica de negocio.

En el ciclo de vida de Nest, el pipe corre antes del controlador. Si la misma validación se moviera al servicio, el request ya habría pasado por el controlador y recién ahí fallaría.

Si se sigue usando `@Param('id', ParseMongoIdPipe)` pero se elimina `@Injectable()` del pipe, Nest ya no lo registra como injectable class enhancer. En esta forma de uso no podría resolverlo correctamente como pipe por clase, así que el pipe dejaría de aplicarse.

### 9. Orden de `setGlobalPrefix`, `enableCors` y `useGlobalPipes`

Mover `app.useGlobalPipes(...)` para que quede antes de `setGlobalPrefix` y `enableCors` no cambia el comportamiento de la app. Son configuraciones globales distintas y ninguna depende del orden entre esas tres líneas mientras todas se registren antes de `app.listen()`.

En cambio, mover `app.enableCors()` para después de `app.listen()` sí afecta el comportamiento esperado. CORS debe quedar registrado antes de que el servidor empiece a aceptar conexiones; si no, las primeras peticiones ya entran sin esa configuración aplicada. El momento correcto es durante el bootstrap, antes de `await app.listen(...)`.

## Verificación

Se completó el módulo `bikes` en:

- `src/bikes/dto/create-bike.dto.ts`
- `src/bikes/bikes.service.ts`
- `src/bikes/bikes.controller.ts`

Además, se instalaron las dependencias del proyecto y la verificación de compilación pasó correctamente con:

- `npm install`
- `npm run lint`
- `npm run build`
