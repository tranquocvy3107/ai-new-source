import { Injectable } from '@nestjs/common';

@Injectable()
export class VectorService {
  embedText(text: string): number[] {
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    const vector = new Array<number>(16).fill(0);
    for (let i = 0; i < normalized.length; i += 1) {
      const bucket = i % vector.length;
      vector[bucket] += normalized.charCodeAt(i) / 255;
    }
    return vector;
  }

  cosineSimilarity(left: number[], right: number[]): number {
    const length = Math.min(left.length, right.length);
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (let i = 0; i < length; i += 1) {
      dot += left[i] * right[i];
      leftNorm += left[i] ** 2;
      rightNorm += right[i] ** 2;
    }
    if (!leftNorm || !rightNorm) {
      return 0;
    }
    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  }
}
