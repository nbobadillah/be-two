
## Respuestas

### 1. Duplicados con `McQueen` y `mcqueen`

Sí. La línea que define ese comportamiento es:

```ts
createCarDto.nombre = createCarDto.nombre.toLowerCase();
```

Está en el método `create` de `src/cars/cars.service.ts`. El servicio convierte `nombre` a minúsculas antes de guardar, así que `"McQueen"` y `"mcqueen"` terminan como `"mcqueen"`. Como `nombre` tiene `unique: true` en `src/cars/entities/car.entity.ts`, el segundo insert viola el índice único y MongoDB responde con el error `11000`.

### 2. Por qué existen las dos validaciones del id

Existen porque están protegiendo dos flujos distintos:

- `findOne` valida dentro del servicio, porque el endpoint `GET /cars/:id` no usa `ParseMongoIdPipe`.
- `remove` valida en el controlador con `@Param('id', ParseMongoIdPipe)`, así que el servicio recibe solo ids con formato válido.

Si `findOne` no tuviera `isValidObjectId(id)` y recibiera `"abc"`, `findById` lanzaría un `CastError` de Mongoose y el cliente recibiría `500 Internal Server Error`.

Si `remove` no usara `ParseMongoIdPipe` y recibiera `"abc"`, `deleteOne` lanzaría el mismo `CastError` y el cliente también recibiría `500`. Con el código actual, `findOne` devuelve `400` desde el servicio y `remove` devuelve `400` desde el pipe, antes de entrar al controlador.

### 3. Por qué `create` usa `try/catch` y `findAll` no

`create` necesita `try/catch` porque escribe en la base de datos y puede disparar errores como `11000` por duplicado en un campo `unique`. `findAll` solo lee con `this.carsModel.find()`, así que no produce ese tipo de error.

El `try/catch` de `create` delega en `handleException(error)`, que convierte `11000` en:

- `BadRequestException`
- HTTP `400`

Si `create` no tuviera `try/catch` y MongoDB lanzara `11000`, Nest lo trataría como un error no controlado y el cliente recibiría `500 Internal Server Error`, no `400`.

### 4. Cuántas consultas hace `update` y si la respuesta puede diferir

En el camino feliz hace 2 consultas a la base de datos:

1. `this.findOne(id)` hace el `findById`.
2. `bike.updateOne(...)` o `car.updateOne(...)` hace el `update`.

No hace una tercera lectura, porque devuelve:

```ts
return { ...car.toJSON(), ...updateCarDto };
```

Sí. La respuesta puede diferir de MongoDB porque mezcla un snapshot viejo del documento con el DTO enviado. Un caso concreto: otra petición cambia `modelo` entre el `findOne` y el `updateOne`; la base queda con el valor nuevo, pero la respuesta todavía puede devolver el viejo.

### 5. Problema de usar `forRoot(process.env.MONGODB_URL || ...)`

El problema es el momento de evaluación. En esta versión:

```ts
MongooseModule.forRoot(process.env.MONGODB_URL || 'mongodb://localhost:27017/nest-cars')
```

JavaScript evalúa `process.env.MONGODB_URL` cuando se carga `app.module.ts`. En ese momento `ConfigModule.forRoot({ isGlobal: true })` todavía puede no haber cargado `.env`, así que el valor puede llegar como `undefined` y usar el fallback local. `forRootAsync({ useFactory })` resuelve eso porque ejecuta la factory después de que Nest inicializa `ConfigModule`.

### 6. Qué pasa si falta `CarsModule` o `forFeature`

Si falta `CarsModule` en `AppModule`, la aplicación puede arrancar, pero las rutas de `cars` no existen y el cliente recibe `404 Not Found`. Si `CarsModule` sí está importado pero falta `MongooseModule.forFeature(...)` en `src/cars/cars.module.ts`, Nest falla al arrancar porque no puede inyectar el modelo `Car`.

### 7. Ventaja de usar `deleteOne` directo

La ventaja es que elimina en una sola consulta. Si primero hiciera `findOne(id)` y luego borrara, haría dos viajes a la base de datos. Aunque `ParseMongoIdPipe` garantiza un ObjectId válido, `deletedCount` puede ser `0` cuando no existe ningún documento con ese `_id`.

### 8. Qué se pierde si la validación del pipe se mueve al servicio

Se pierde una ventaja arquitectónica: validación reutilizable en la entrada HTTP. El pipe corre antes del controlador; en el servicio, la validación ocurre después. Si se usa `@Param('id', ParseMongoIdPipe)` pero se elimina `@Injectable()`, Nest no resuelve el pipe como clase y deja de aplicarlo.

### 9. Orden de `setGlobalPrefix`, `enableCors` y `useGlobalPipes`

Mover `app.useGlobalPipes(...)` antes de `setGlobalPrefix` y `enableCors` no cambia el comportamiento, porque las tres configuraciones siguen registrándose antes de `app.listen()`. En cambio, mover `app.enableCors()` después de `app.listen()` sí afecta la app, porque CORS debe quedar registrado antes de que el servidor empiece a recibir peticiones.
