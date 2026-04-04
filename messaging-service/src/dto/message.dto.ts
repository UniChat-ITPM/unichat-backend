import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsInt,
  Min,
  IsArray,
} from 'class-validator';

export class SendTextMessageDto {
  @IsUUID()
  @IsNotEmpty()
  conversationId: string;

  @IsString()
  @IsNotEmpty()
  text: string;

  @IsUUID()
  @IsOptional()
  replyToMessageId?: string;
}

export class SendMediaMessageDto {
  @IsUUID()
  @IsNotEmpty()
  conversationId: string;

  @IsArray()
  @IsUUID('all', { each: true })
  @IsNotEmpty()
  mediaAssetIds: string[];

  @IsString()
  @IsOptional()
  caption?: string;

  @IsUUID()
  @IsOptional()
  replyToMessageId?: string;
}

export class EditMessageDto {
  @IsString()
  @IsNotEmpty()
  newText: string;
}

export class MessagePaginationDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}
