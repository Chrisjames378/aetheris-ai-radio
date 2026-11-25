function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

export function encodeStereoWavBlob(
  leftChunks: Float32Array[],
  rightChunks: Float32Array[],
  sampleRate: number
): Blob {
  const totalSamples = leftChunks.reduce((acc, c) => acc + c.length, 0);
  const numChannels = 2;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = totalSamples * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let chunkIdx = 0; chunkIdx < leftChunks.length; chunkIdx++) {
    const left = leftChunks[chunkIdx];
    const right = rightChunks[chunkIdx];
    for (let i = 0; i < left.length; i++) {
      const lSample = Math.max(-1, Math.min(1, left[i]));
      const rSample = Math.max(-1, Math.min(1, right[i] ?? left[i]));
      view.setInt16(
        offset,
        lSample < 0 ? lSample * 0x8000 : lSample * 0x7fff,
        true
      );
      view.setInt16(
        offset + 2,
        rSample < 0 ? rSample * 0x8000 : rSample * 0x7fff,
        true
      );
      offset += 4;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
