import { IsNotEmpty, IsString } from 'class-validator';

export class SpamCheckDto {
  @IsNotEmpty()
  @IsString()
  content!: string;
}
