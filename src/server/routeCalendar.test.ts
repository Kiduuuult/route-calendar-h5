import assert from "node:assert/strict";
import test from "node:test";
import { getRouteCalendarSnapshot } from "./routeCalendar";

test("builds a full-table snapshot containing only published records", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });

  process.env.LARK_APP_ID = "app";
  process.env.LARK_APP_SECRET = "secret";
  process.env.LARK_APP_TOKEN = "base";
  process.env.LARK_TABLE_ID = "routes";
  process.env.LARK_PARTNER_TABLE_ID = "gyms";

  const requestedUrls: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    requestedUrls.push(url);

    if (url.pathname.endsWith("/tenant_access_token/internal")) {
      return Response.json({ code: 0, tenant_access_token: "token", expire: 7200 });
    }
    if (url.pathname.includes("/tables/routes/records")) {
      return Response.json({ data: { has_more: false, items: [
        { record_id: "published", fields: { "对外展示状态": "已发布", "城市": "上海", "岩馆名称": "测试岩馆", "计划状态": "已确认" } },
        { record_id: "pending", fields: { "对外展示状态": "待运营审核", "城市": "上海", "岩馆名称": "待审核岩馆", "计划状态": "已确认" } },
        { record_id: "cancelled", fields: { "对外展示状态": "已发布", "城市": "上海", "岩馆名称": "取消岩馆", "计划状态": "取消" } },
      ] } });
    }
    if (url.pathname.includes("/tables/gyms/records")) {
      return Response.json({ data: { has_more: false, items: [
        { record_id: "gym", fields: { "合作状态": "有效合作", "城市": "上海", "岩馆名称": "测试岩馆" } },
      ] } });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const snapshot = await getRouteCalendarSnapshot();

  assert.deepEqual(snapshot.items.map((item) => item.id), ["published"]);
  const routeRequest = requestedUrls.find((url) => url.pathname.includes("/tables/routes/records"));
  assert.equal(routeRequest?.searchParams.has("view_id"), false);
});
