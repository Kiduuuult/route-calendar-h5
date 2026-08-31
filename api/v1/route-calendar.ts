import { getRouteCalendar } from "../../src/server/routeCalendar";

type Request = {
  query: Record<string, string | string[] | undefined>;
};

type Response = {
  json: (body: unknown) => void;
  status: (code: number) => Response;
};

function queryValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function handler(request: Request, response: Response) {
  try {
    const page = Math.max(1, Number(queryValue(request.query.page) ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(queryValue(request.query.pageSize) ?? 20) || 20));
    const data = await getRouteCalendar({
      city: queryValue(request.query.city),
      from: queryValue(request.query.from),
      to: queryValue(request.query.to),
      keyword: queryValue(request.query.keyword),
      page,
      pageSize,
    });
    response.json(data);
  } catch (error) {
    console.error("Route calendar API request failed:", error instanceof Error ? error.message : error);
    response.status(500).json({ message: "暂时无法获取换线安排" });
  }
}
