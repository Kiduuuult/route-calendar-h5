import type { RouteCalendarResponse, RouteEvent } from "../shared/types";

type Query = {
  city?: string;
  from?: string;
  to?: string;
  keyword?: string;
  page: number;
  pageSize: number;
};

type LarkRecord = {
  record_id: string;
  fields: Record<string, unknown>;
};

let tenantAccessTokenCache: { value: string; expiresAt: number } | null = null;

async function getTenantAccessToken(appId: string, appSecret: string) {
  const now = Date.now();
  if (tenantAccessTokenCache && tenantAccessTokenCache.expiresAt > now) return tenantAccessTokenCache.value;

  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  if (!response.ok) throw new Error(`Lark tenant token request failed: ${response.status}`);

  const payload = await response.json() as { code?: number; msg?: string; tenant_access_token?: string; expire?: number };
  if (payload.code !== 0 || !payload.tenant_access_token) throw new Error(`Lark tenant token request failed: ${payload.msg ?? "unknown error"}`);

  // Refresh five minutes early so a token cannot expire midway through pagination or image resolution.
  tenantAccessTokenCache = {
    value: payload.tenant_access_token,
    expiresAt: now + Math.max((payload.expire ?? 7200) - 300, 60) * 1000,
  };
  return tenantAccessTokenCache.value;
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return text(value[0]);
  if (value && typeof value === "object" && "text" in value) return text((value as { text: unknown }).text);
  return null;
}

function textList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter((item): item is string => Boolean(item));
  const item = text(value);
  return item ? [item] : [];
}

function isoDateTime(value: unknown): string | null {
  if (typeof value === "number") return new Date(value).toISOString();
  const item = text(value);
  if (!item) return null;
  if (item.match(/^\d{10,13}$/)) return new Date(item.length === 10 ? Number(item) * 1000 : Number(item)).toISOString();
  const parsed = new Date(item);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function chinaDate(value: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${read("year")}-${read("month")}-${read("day")}`;
}

type Attachment = { fileToken: string; name?: string };

function attachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const attachment = item as { file_token?: unknown; name?: unknown };
    return typeof attachment.file_token === "string" ? [{ fileToken: attachment.file_token, name: text(attachment.name) ?? undefined }] : [];
  });
}

function mapLarkRecord(record: LarkRecord): RouteEvent | null {
  const fields = record.fields;
  const city = text(fields["城市"]);
  const gymName = text(fields["岩馆名称（填写）"]);
  if (!city || !gymName) return null;
  const planStatus = text(fields["计划状态"]);
  const publishedAt = isoDateTime(fields["最后更新时间"]) ?? new Date().toISOString();
  const routeCountValue = Number(text(fields["更新路线数量"]));

  return {
    id: record.record_id,
    city,
    gymName,
    dismantleAt: isoDateTime(fields["预计拆线时间"]) ?? isoDateTime(fields["拆线开始时间"]),
    constructionStartAt: isoDateTime(fields["预计换线/施工时间"]) ?? isoDateTime(fields["换线施工时间"]),
    openingAt: isoDateTime(fields["预计新线开放时间"]),
    planStatus: planStatus === "已确认" || planStatus === "变更" || planStatus === "取消" ? planStatus : "已确认",
    areas: textList(fields["换线区域"]),
    areaNote: text(fields["区域补充说明"]),
    routeCount: Number.isFinite(routeCountValue) ? routeCountValue : null,
    gradeSystem: text(fields["难度体系"]),
    gradeRange: text(fields["难度范围"]),
    highlights: text(fields["主题或亮点"]),
    images: [],
    publishedAt,
  };
}

async function resolveAttachmentUrls(attachments: Attachment[], accessToken: string) {
  const urls = new Map<string, string>();
  const tokens = [...new Set(attachments.map((attachment) => attachment.fileToken))];

  for (let index = 0; index < tokens.length; index += 5) {
    const url = new URL("https://open.feishu.cn/open-apis/drive/v1/medias/batch_get_tmp_download_url");
    tokens.slice(index, index + 5).forEach((token) => url.searchParams.append("file_tokens", token));
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`Lark media URL request failed: ${response.status}`);
    const payload = await response.json() as {
      data?: { tmp_download_urls?: Array<{ file_token?: string; tmp_download_url?: string }> };
    };
    payload.data?.tmp_download_urls?.forEach((item) => {
      if (item.file_token && item.tmp_download_url) urls.set(item.file_token, item.tmp_download_url);
    });
  }

  return urls;
}

function eventStartDate(event: RouteEvent) {
  return [event.dismantleAt, event.constructionStartAt, event.openingAt]
    .filter((value): value is string => Boolean(value))
    .map(chinaDate)
    .sort()[0] ?? null;
}

function eventEndDate(event: RouteEvent) {
  const latestPoint = [event.openingAt, event.constructionStartAt, event.dismantleAt]
    .find((value): value is string => Boolean(value));
  return latestPoint ? chinaDate(latestPoint) : null;
}

function matchesDate(event: RouteEvent, from?: string, to?: string) {
  const startDate = eventStartDate(event);
  const endDate = eventEndDate(event) ?? startDate;
  if (!startDate || !endDate) return true;
  if (from && endDate < from) return false;
  if (to && startDate > to) return false;
  return true;
}

function sortEvents(a: RouteEvent, b: RouteEvent) {
  const aStart = eventStartDate(a);
  const bStart = eventStartDate(b);
  if (aStart && bStart) return aStart.localeCompare(bStart);
  if (aStart) return -1;
  if (bStart) return 1;
  return b.publishedAt.localeCompare(a.publishedAt);
}

async function getPublishedEvents(): Promise<RouteEvent[]> {
  const { LARK_APP_ID, LARK_APP_SECRET, LARK_APP_TOKEN, LARK_TABLE_ID, LARK_VIEW_ID } = process.env;
  if (!LARK_APP_ID || !LARK_APP_SECRET || !LARK_APP_TOKEN || !LARK_TABLE_ID || !LARK_VIEW_ID) {
    throw new Error("Missing Lark Base environment configuration");
  }
  const accessToken = await getTenantAccessToken(LARK_APP_ID, LARK_APP_SECRET);

  const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${LARK_APP_TOKEN}/tables/${LARK_TABLE_ID}/records`);
  url.searchParams.set("view_id", LARK_VIEW_ID);
  url.searchParams.set("page_size", "100");
  const records: LarkRecord[] = [];
  let pageToken: string | undefined;

  do {
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`Lark data request failed: ${response.status}`);
    const payload = await response.json() as { data?: { has_more?: boolean; items?: LarkRecord[]; page_token?: string } };
    records.push(...(payload.data?.items ?? []));
    pageToken = payload.data?.has_more ? payload.data.page_token : undefined;
  } while (pageToken);

  // The configured view is "对外页面数据源", whose records have already been filtered to 已发布.
  const mapped = records.flatMap((record) => {
    const event = mapLarkRecord(record);
    return event ? [{ event, attachments: attachments(record.fields["现场图片"])}] : [];
  });
  let mediaUrls = new Map<string, string>();
  try {
    mediaUrls = await resolveAttachmentUrls(mapped.flatMap((item) => item.attachments), accessToken);
  } catch (error) {
    console.warn("Unable to resolve Lark attachment URLs; continuing without images.", error);
  }

  return mapped.map(({ event, attachments }) => ({
    ...event,
    images: attachments.flatMap(({ fileToken, name }) => {
      const url = mediaUrls.get(fileToken);
      return url ? [{ url, name }] : [];
    }),
  })).filter((event) => event.planStatus !== "取消");
}

export async function getRouteCalendar(query: Query): Promise<RouteCalendarResponse> {
  const allEvents = await getPublishedEvents();
  const keyword = query.keyword?.trim().toLocaleLowerCase();
  const filtered = allEvents
    .filter((event) => !query.city || event.city === query.city)
    .filter((event) => matchesDate(event, query.from, query.to))
    .filter((event) => !keyword || [event.gymName, event.city, event.areas.join(" "), event.highlights ?? ""].join(" ").toLocaleLowerCase().includes(keyword))
    .sort(sortEvents);
  const start = (query.page - 1) * query.pageSize;

  return {
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total: filtered.length,
      generatedAt: new Date().toISOString(),
    },
    filters: {
      cities: [...new Set(allEvents.map((event) => event.city))].sort(),
      areas: [...new Set(allEvents.flatMap((event) => event.areas))].sort(),
    },
    items: filtered.slice(start, start + query.pageSize),
  };
}
