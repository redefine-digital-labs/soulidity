declare module 'xml2js' {
  export interface Options {
    [key: string]: unknown
  }

  export class Parser {
    constructor(options?: Options)
    parseStringPromise(xml: string): Promise<unknown>
  }
}
