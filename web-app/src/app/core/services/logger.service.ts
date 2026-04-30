import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class LoggerService {
  private isProduction = environment.production;

  constructor() {}

  log(message?: any, ...optionalParams: any[]): void {
    if (!this.isProduction) {
      console.log(message, ...optionalParams);
    }
  }

  warn(message?: any, ...optionalParams: any[]): void {
    if (!this.isProduction) {
      console.warn(message, ...optionalParams);
    }
  }

  error(message?: any, ...optionalParams: any[]): void {
    if (!this.isProduction) {
      console.error(message, ...optionalParams);
    }
  }

  debug(message?: any, ...optionalParams: any[]): void {
    if (!this.isProduction) {
      console.debug(message, ...optionalParams);
    }
  }

  info(message?: any, ...optionalParams: any[]): void {
    if (!this.isProduction) {
      console.info(message, ...optionalParams);
    }
  }
}
