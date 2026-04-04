import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';

/** Keep equal to `user-service` `CONTACT_MATCH_MAX_BATCH`. */
const CONTACT_MATCH_MAX_BATCH = 1000;

export class MatchContactsGatewayDto {
  @IsArray({ message: 'phoneNumbers must be an array' })
  @ArrayMaxSize(CONTACT_MATCH_MAX_BATCH, {
    message: `phoneNumbers must contain at most ${CONTACT_MATCH_MAX_BATCH} entries`,
  })
  @IsString({ each: true })
  @Matches(/^\+[1-9]\d{7,14}$/, {
    each: true,
    message:
      'Each phone number must be E.164 (leading +, country code, 8–15 digits total after +)',
  })
  @Transform(({ value }) => {
    if (!Array.isArray(value)) {
      return value;
    }
    return value.map((v) =>
      typeof v === 'string' ? v.trim().replace(/\s+/g, '') : v,
    );
  })
  phoneNumbers!: string[];

  @IsOptional()
  @IsBoolean()
  excludeSelf?: boolean;
}
