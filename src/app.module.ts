import { Module } from '@nestjs/common';
import { ContentModule } from './content/content.module';

@Module({
  imports: [ContentModule],
})
export class AppModule {}
