import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getRouteCalendar } from "../src/server/routeCalendar";
import type { RouteImage } from "../src/shared/types";

const outputDirectory = path.resolve(process.cwd(), "public", "data");
const imageDirectory = path.join(outputDirectory, "images");

function extensionFor(contentType: string | null) {
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("webp")) return "webp";
  if (contentType?.includes("gif")) return "gif";
  return "jpg";
}

async function downloadImage(image: RouteImage, eventId: string, index: number): Promise<RouteImage | null> {
  try {
    const response = await fetch(image.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const filename = `${eventId.replace(/[^a-zA-Z0-9_-]/g, "_")}-${index + 1}.${extensionFor(response.headers.get("content-type"))}`;
    await writeFile(path.join(imageDirectory, filename), Buffer.from(await response.arrayBuffer()));
    return { name: image.name, url: `data/images/${filename}` };
  } catch (error) {
    console.warn(`Skipping an image for ${eventId}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

async function main() {
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(imageDirectory, { recursive: true });

  const calendar = await getRouteCalendar({ page: 1, pageSize: 100 });
  for (const event of calendar.items) {
    const images = await Promise.all(event.images.map((image, index) => downloadImage(image, event.id, index)));
    event.images = images.filter((image): image is RouteImage => image !== null);
  }

  await writeFile(path.join(outputDirectory, "route-calendar.json"), `${JSON.stringify(calendar, null, 2)}\n`);
  console.log(`Generated ${calendar.items.length} route-calendar records.`);
}

await main();
