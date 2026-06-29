declare module '@breezystack/lamejs' {
  export class Mp3Encoder {
    constructor(channels: number, samplerate: number, kbps: number);
    encodeBuffer(leftChannel: Int16Array, rightChannel?: Int16Array): Int8Array;
    flush(): Int8Array;
  }
}
