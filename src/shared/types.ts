export interface RouteImage {
  url: string;
  name?: string;
}

export type PlanStatus = "已确认" | "变更" | "取消" | string;

export interface PartnerGym {
  id: string;
  name: string;
  aliases: string[];
  city: string;
  district: string | null;
  address: string | null;
  disciplines: string[];
  gradeSystems: string[];
  homepageUrl: string | null;
  updatedAt: string | null;
}

export interface RouteEvent {
  id: string;
  gymId: string | null;
  city: string;
  gymName: string;
  dismantleAt: string | null;
  constructionStartAt: string | null;
  openingAt: string | null;
  planStatus: PlanStatus;
  areas: string[];
  areaNote: string | null;
  routeCount: number | null;
  gradeSystem: string | null;
  gradeRange: string | null;
  highlights: string | null;
  images: RouteImage[];
  publishedAt: string;
}

export interface RouteCalendarResponse {
  meta: {
    page: number;
    pageSize: number;
    total: number;
    generatedAt: string;
  };
  filters: {
    cities: string[];
    areas: string[];
    gymCities: string[];
  };
  gyms: PartnerGym[];
  items: RouteEvent[];
}
