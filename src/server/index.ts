import "dotenv/config";
import cors from "cors";
import express from "express";
import { getRouteCalendar } from "./routeCalendar";

const app = express();
const port = Number(process.env.PORT ?? 8787);

app.use(cors());

app.get("/api/v1/route-calendar", async (request, response) => {
  try {
    const page = Math.max(1, Number(request.query.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(request.query.pageSize ?? 20) || 20));
    const data = await getRouteCalendar({
      city: typeof request.query.city === "string" ? request.query.city : undefined,
      from: typeof request.query.from === "string" ? request.query.from : undefined,
      to: typeof request.query.to === "string" ? request.query.to : undefined,
      keyword: typeof request.query.keyword === "string" ? request.query.keyword : undefined,
      page,
      pageSize,
    });
    response.json(data);
  } catch (error) {
    console.error("Route calendar API request failed:", error instanceof Error ? error.message : error);
    response.status(500).json({ message: "暂时无法获取换线安排" });
  }
});

app.listen(port, () => {
  console.log(`Route calendar API available at http://localhost:${port}`);
});
