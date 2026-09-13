import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { HealthModule } from './common/health/health.module';
import { validateEnvironment } from './config/environment';
import { DocumentationDatabaseModule } from './database/documentation-database.module';
import { AmenityModule } from './module/amenity/amenity.module';
import { AuditModule } from './module/audit/audit.module';
import { AuthModule } from './module/auth/auth.module';
import { BookingModule } from './module/booking/booking.module';
import { ChatModule } from './module/chat/chat.module';
import { CustomerModule } from './module/customer/customer.module';
import { PaymentModule } from './module/payment/payment.module';
import { RoomModule } from './module/room/room.module';
import { RoomTypeModule } from './module/room-type/room-type.module';
import { UserModule } from './module/user/user.module';

const persistenceModule =
  process.env.OPENAPI_GENERATION === 'true'
    ? DocumentationDatabaseModule
    : TypeOrmModule.forRootAsync({
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
          connectTimeout: configService.getOrThrow<number>(
            'DB_CONNECT_TIMEOUT_MS',
          ),
          poolSize: configService.getOrThrow<number>('DB_POOL_SIZE'),
          extra: {
            waitForConnections: true,
            queueLimit: configService.getOrThrow<number>('DB_POOL_QUEUE_LIMIT'),
            maxIdle: configService.getOrThrow<number>('DB_POOL_SIZE'),
            idleTimeout: 60_000,
            enableKeepAlive: true,
          },
          autoLoadEntities: true,
          // Do not use synchronize; schema is managed through migrations.
          synchronize: false,
          migrations: [__dirname + '/database/migrations/*{.js,.ts}'],
          migrationsTableName: 'typeorm_migrations',
          migrationsRun: true,
        }),
      });

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
      validate: validateEnvironment,
    }),
    ScheduleModule.forRoot(),
    HealthModule,
    persistenceModule,
    AuthModule,
    AuditModule,
    AmenityModule,
    BookingModule,
    ChatModule,
    CustomerModule,
    PaymentModule,
    RoomModule,
    RoomTypeModule,
    UserModule,
  ],
})
export class AppModule {}
