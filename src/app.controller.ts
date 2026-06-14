import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

@ApiExcludeController()
@Controller()
export class AppController {
  constructor() {}

  @Get()
  getHello(): string {
    return "Hello World";
  }

  @Get('health')
  getHealth() {
    return {
      status: "ok",
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
    }
  }
}
