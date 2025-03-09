declare module 'minimatch' {
  export function minimatch(target: string, pattern: string, options?: any): boolean;
  export class Minimatch {
    constructor(pattern: string, options?: any);
    match(target: string): boolean;
  }
} 