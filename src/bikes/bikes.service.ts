import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { Bike } from './entities/bike.entity';
import { CreateBikeDto } from './dto/create-bike.dto';
import { UpdateBikeDto } from './dto/update-bike.dto';

@Injectable()
export class BikesService {
  private readonly logger = new Logger('Bikes');

  constructor(
    @InjectModel(Bike.name)
    private readonly bikesModel: Model<Bike>,
  ) {}

  async findAll() {
    return this.bikesModel.find();
  }

  async findOne(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Id is not a valid object id`);
    }

    const bike = await this.bikesModel.findById(id);

    if (!bike) {
      throw new NotFoundException(`Bike with id ${id} not found`);
    }

    return bike;
  }

  async create(createBikeDto: CreateBikeDto) {
    createBikeDto.marca = createBikeDto.marca.toLowerCase();

    try {
      const bike = await this.bikesModel.create(createBikeDto);
      return bike;
    } catch (error) {
      this.handleException(error);
    }
  }

  async update(id: string, updateBikeDto: UpdateBikeDto) {
    if (updateBikeDto.marca) {
      updateBikeDto.marca = updateBikeDto.marca.toLowerCase();
    }

    const bike = await this.findOne(id);

    try {
      await bike.updateOne(updateBikeDto);
      return { ...bike.toJSON(), ...updateBikeDto };
    } catch (error) {
      this.handleException(error);
    }
  }

  async remove(id: string) {
    const { deletedCount } = await this.bikesModel.deleteOne({ _id: id });

    if (deletedCount === 0) {
      throw new BadRequestException(`Bike with id ${id} not found`);
    }

    return;
  }

  private handleException(error: any) {
    if (error.code === 11000) {
      throw new BadRequestException(
        `Bike exists in db ${JSON.stringify(error.keyValue)}`,
      );
    }
    this.logger.error(error);
    throw new InternalServerErrorException(
      `Can't process request, check server logs`,
    );
  }
}
