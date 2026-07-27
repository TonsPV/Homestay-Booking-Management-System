import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnvironment } from './config/environment';
import { AuthModule } from './module/auth/auth.module';
import { AmenityModule } from './module/amenity/amenity.module';
import { BookingModule } from './module/booking/booking.module';
import { CustomerModule } from './module/customer/customer.module';
import { PaymentModule } from './module/payment/payment.module';
import { RoomModule } from './module/room/room.module';
import { RoomTypeModule } from './module/room-type/room-type.module';
import { UserModule } from './module/user/user.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
      validate: validateEnvironment,
    }),
    ScheduleModule.forRoot(),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],

      useFactory: (configService: ConfigService) => ({
        type: 'mysql',

        host: configService.getOrThrow<string>('DB_HOST'),
        port: Number(configService.getOrThrow<string>('DB_PORT')),

        username: configService.getOrThrow<string>('DB_USERNAME'),
        password: configService.getOrThrow<string>('DB_PASSWORD'),
        database: configService.getOrThrow<string>('DB_DATABASE'),
        timezone: 'Z',

        autoLoadEntities: true,

        // Không để TypeORM tự ý sửa cấu trúc database.
        synchronize: false,
      }),
    }),
    AuthModule,
    AmenityModule,
    BookingModule,
    CustomerModule,
    PaymentModule,
    RoomModule,
    RoomTypeModule,
    UserModule,
  ],

  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
