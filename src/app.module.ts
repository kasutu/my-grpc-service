import { Module } from '@nestjs/common';
import { ContentModule } from './content/content.module';
import { CommandModule } from './command/command.module';

@Module({
  imports: [ContentModule, CommandModule],
})
export class AppModule {}
