import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Car } from '../cars/entities/car.entity';

@Injectable()
export class SeedService {
  constructor(
    @InjectModel(Car.name)
    private readonly carsModel: Model<Car>,
  ) {}

  async executeSeed() {
    await this.carsModel.deleteMany({});

    const cars = await this.carsModel.insertMany([
      {
        nombre: 'mcqueen',
        modelo: 'Lightning',
        anio: 2006,
        frase: 'Ka-chow!',
      },
      {
        nombre: 'mater',
        modelo: 'Tow Truck',
        anio: 1951,
        frase: 'Git-R-Done!',
      },
      {
        nombre: 'doc',
        modelo: 'Hudson Hornet',
        anio: 1951,
        frase: 'You can go.',
      },
      {
        nombre: 'sally',
        modelo: 'Porsche 911',
        anio: 2002,
        frase: 'I decide who I race.',
      },
      {
        nombre: 'ramone',
        modelo: 'Impala',
        anio: 1959,
        frase: 'Low and slow.',
      },
    ]);

    return cars;
  }
}
