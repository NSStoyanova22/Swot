declare module "tesseract.js-node" {
  type TesseractNodeWorker = {
    recognize: (input: string | Buffer, language: string) => string;
  };

  type TesseractNodeOptions = {
    tessdata: string | Buffer;
    languages: string[];
  };

  function createWorker(options: TesseractNodeOptions): Promise<TesseractNodeWorker>;

  export = createWorker;
}
