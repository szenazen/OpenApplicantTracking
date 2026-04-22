import { Global, Module } from '@nestjs/common';
import { JobPermissionsService } from './job-permissions.service';

@Global()
@Module({
  providers: [JobPermissionsService],
  exports: [JobPermissionsService],
})
export class JobPermissionsModule {}
