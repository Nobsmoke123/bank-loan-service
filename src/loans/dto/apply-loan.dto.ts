import { IsInt, IsNumber, Max, Min } from 'class-validator';

export class ApplyLoanDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1000)
  amount: number;

  @IsInt()
  @Min(1)
  @Max(60)
  durationInMonths: number;
}
