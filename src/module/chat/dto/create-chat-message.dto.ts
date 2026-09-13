import { ApiProperty } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class CreateChatMessageDto {
  @ApiProperty({
    example: 'Cho toi hoi thoi gian nhan phong nhe.',
    minLength: 1,
    maxLength: 2000,
    type: String,
  })
  @Allow()
  content!: unknown;

  @ApiProperty({
    example: '018f41f6-7d22-70ce-9dd4-6c0ec4d33256',
    maxLength: 100,
    type: String,
    description:
      'A stable client-generated id. Retrying the same message must reuse this value.',
  })
  @Allow()
  clientMessageId!: unknown;
}
