import { ReflectionService } from '@grpc/reflection';
import { GrpcOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';

export const grpcClientOptions: GrpcOptions = {
  transport: Transport.GRPC,
  options: {
    package: ['content.v1', 'remote.v1', 'analytics.v1'], // All packages
    protoPath: [
      join(__dirname, './content/v1/content.proto'),
      join(__dirname, './command/v1/command.proto'),
      join(__dirname, './analytics/v1/analytics.proto'),
    ],
    url: '0.0.0.0:50051',
    onLoadPackageDefinition: (pkg, server) => {
      new ReflectionService(pkg).addToServer(server);
    },
  },
};
