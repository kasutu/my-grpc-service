import { Module } from '@nestjs/common';
import { ContentController } from './content.controller';
import { ContentHttpController } from './content-http.controller';
import { ContentPublisherService } from './content-publisher.service';

@Module({
  providers: [ContentPublisherService],
  controllers: [ContentController, ContentHttpController],
})
export class ContentModule {}
