/* global Image, ImageData, document */
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const referencePath = ".omx/artifacts/visual-ralph/humanoid-redesign/reference-v1.png";
const actualPath = ".omx/artifacts/visual-ralph/humanoid-redesign/actual-cooperation.png";
const diffPath = ".omx/artifacts/visual-ralph/humanoid-redesign/pixel-diff.png";

const [reference, actual] = await Promise.all([readFile(referencePath), readFile(actualPath)]);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const result = await page.evaluate(async ({ referenceUrl, actualUrl }) => {
    const width = 960;
    const height = 640;
    const load = async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    };
    const drawCover = (context, image) => {
      const scale = Math.max(width / image.width, height / image.height);
      const drawWidth = image.width * scale;
      const drawHeight = image.height * scale;
      context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    };
    const [referenceImage, actualImage] = await Promise.all([load(referenceUrl), load(actualUrl)]);
    const left = document.createElement("canvas");
    const right = document.createElement("canvas");
    left.width = right.width = width;
    left.height = right.height = height;
    const leftContext = left.getContext("2d", { willReadFrequently: true });
    const rightContext = right.getContext("2d", { willReadFrequently: true });
    drawCover(leftContext, referenceImage);
    drawCover(rightContext, actualImage);
    const referencePixels = leftContext.getImageData(0, 0, width, height);
    const actualPixels = rightContext.getImageData(0, 0, width, height);
    const diff = new ImageData(width, height);
    let total = 0;
    for (let index = 0; index < diff.data.length; index += 4) {
      const red = Math.abs(referencePixels.data[index] - actualPixels.data[index]);
      const green = Math.abs(referencePixels.data[index + 1] - actualPixels.data[index + 1]);
      const blue = Math.abs(referencePixels.data[index + 2] - actualPixels.data[index + 2]);
      total += red + green + blue;
      diff.data[index] = Math.min(255, red * 2.5);
      diff.data[index + 1] = Math.min(255, green * 2.5);
      diff.data[index + 2] = Math.min(255, blue * 2.5);
      diff.data[index + 3] = 255;
    }
    const output = document.createElement("canvas");
    output.width = width;
    output.height = height;
    output.getContext("2d").putImageData(diff, 0, 0);
    return {
      dataUrl: output.toDataURL("image/png"),
      meanAbsoluteChannelDelta: total / (width * height * 3),
      normalizedDelta: total / (width * height * 3 * 255),
      comparedSize: `${width}x${height}`,
    };
  }, {
    referenceUrl: `data:image/png;base64,${reference.toString("base64")}`,
    actualUrl: `data:image/png;base64,${actual.toString("base64")}`,
  });
  await writeFile(diffPath, Buffer.from(result.dataUrl.split(",")[1], "base64"));
  console.log(JSON.stringify({ ...result, dataUrl: undefined, referencePath, actualPath, diffPath }, null, 2));
} finally {
  await browser.close();
}
