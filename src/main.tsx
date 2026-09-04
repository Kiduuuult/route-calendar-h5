import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Construction,
  ExternalLink,
  Filter,
  MapPin,
  Mountain,
  Navigation,
  Search,
  Sparkles,
  Store,
  Wrench,
  X,
} from "lucide-react";
import { createRoot } from "react-dom/client";
import type { PartnerGym, RouteCalendarResponse, RouteEvent, RouteImage } from "./shared/types";
import "./styles.css";

const weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"];
const today = new Date();
const todayKey = dateKey(today);
type AppTab = "routes" | "gyms";

function initialTab(): AppTab {
  return new URLSearchParams(window.location.search).get("tab") === "gyms" ? "gyms" : "routes";
}

function initialGymId() {
  return new URLSearchParams(window.location.search).get("gym") ?? "";
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function eventDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dateKey(date);
}

function monthLabel(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function datesForMonth(month: Date) {
  const first = startOfMonth(month);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - offset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function eventStartDate(event: RouteEvent) {
  return [eventDate(event.dismantleAt), eventDate(event.constructionStartAt), eventDate(event.openingAt)]
    .filter((value): value is string => Boolean(value))
    .sort()[0] ?? null;
}

function eventEndDate(event: RouteEvent) {
  const latestPoint = [event.openingAt, event.constructionStartAt, event.dismantleAt]
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => b.localeCompare(a))[0];
  return latestPoint ? eventDate(latestPoint) : null;
}

function eventOverlapsMonth(event: RouteEvent, month: Date) {
  const startDate = eventStartDate(event);
  const endDate = eventEndDate(event) ?? startDate;
  const from = dateKey(startOfMonth(month));
  const to = dateKey(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  return Boolean(startDate && endDate && startDate <= to && endDate >= from);
}

function eventForDate(event: RouteEvent, date: string) {
  return eventDate(event.openingAt) === date;
}

function gymCount(events: RouteEvent[]) {
  return new Set(events.map((event) => event.gymName)).size;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间待确认";
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours();
  const minute = date.getMinutes();
  if (hour === 0 && minute === 0) return `${month}月${day}日`;
  return `${month}月${day}日 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function daysBetween(from: string, to: string) {
  return Math.round((dateFromKey(to).getTime() - dateFromKey(from).getTime()) / 86_400_000);
}

function relativeOpeningText(value: string, direction: "past" | "future") {
  const key = eventDate(value);
  if (!key) return null;
  const days = direction === "past" ? daysBetween(key, todayKey) : daysBetween(todayKey, key);
  if (days === 0) return direction === "past" ? "今天开放" : "今天开放";
  return direction === "past" ? `已开放 ${days} 天` : `还有 ${days} 天`;
}

function eventDisruptionDate(event: RouteEvent) {
  return eventDate(event.dismantleAt) ?? eventDate(event.constructionStartAt);
}

function latestOpenedByGym(events: RouteEvent[]) {
  const latest = new Map<string, RouteEvent>();
  events.forEach((event) => {
    const opening = eventDate(event.openingAt);
    if (!opening || opening > todayKey) return;
    const key = event.gymId ?? `${event.city}::${event.gymName}`;
    const current = latest.get(key);
    if (!current || (eventDate(current.openingAt) ?? "") < opening) latest.set(key, event);
  });
  return [...latest.values()].sort((a, b) => (eventDate(b.openingAt) ?? "").localeCompare(eventDate(a.openingAt) ?? ""));
}

function updateImageIndex(element: HTMLDivElement | null, next: (index: number) => void) {
  if (!element?.clientWidth) return;
  next(Math.round(element.scrollLeft / element.clientWidth));
}

function updateUrl(tab: AppTab, gymId?: string, eventId?: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tab);
  if (gymId) url.searchParams.set("gym", gymId);
  else url.searchParams.delete("gym");
  if (eventId) url.searchParams.set("event", eventId);
  else url.searchParams.delete("event");
  window.history.pushState(null, "", url);
}

function actionStatus(event: RouteEvent): { key: "open" | "construction" | "upcoming"; text: string } {
  const constructionStart = eventDate(event.constructionStartAt);
  const opening = eventDate(event.openingAt);
  if (opening && opening <= todayKey) return { key: "open", text: "新线已开放" };
  if (constructionStart && constructionStart <= todayKey && (!opening || opening >= todayKey)) return { key: "construction", text: "施工中" };
  if (constructionStart && constructionStart > todayKey) return { key: "upcoming", text: "即将施工" };
  return { key: "upcoming", text: "即将施工" };
}

function queryString(page: number) {
  return new URLSearchParams({ page: String(page), pageSize: "100" }).toString();
}

async function fetchAllEvents(signal: AbortSignal) {
  if (import.meta.env.VITE_STATIC_DATA === "true") {
    const staticDataUrl = new URL(`${import.meta.env.BASE_URL}data/route-calendar.json`, window.location.origin);
    staticDataUrl.searchParams.set("updatedAt", String(Date.now()));
    const response = await fetch(staticDataUrl, { signal, cache: "no-store" });
    if (!response.ok) throw new Error("Route calendar static data request failed");
    return await response.json() as RouteCalendarResponse;
  }

  let page = 1;
  let result: RouteCalendarResponse | null = null;
  const items: RouteEvent[] = [];
  do {
    const response = await fetch(`/api/v1/route-calendar?${queryString(page)}`, { signal });
    if (!response.ok) throw new Error("Route calendar request failed");
    result = await response.json() as RouteCalendarResponse;
    items.push(...result.items);
    page += 1;
  } while (result && items.length < result.meta.total);
  if (!result) throw new Error("Route calendar response missing");
  return { ...result, items };
}

function WallPreview({ image, gymName }: { image?: RouteImage; gymName: string }) {
  return image ? (
    <img className="wall-preview" src={image.url} alt={image.name ?? `${gymName}现场图片`} />
  ) : (
    <div className="wall-preview wall-fallback" aria-label={`${gymName}现场图片待补充`}>
      <Construction size={22} />
      <span>现场图片待补充</span>
    </div>
  );
}

function GalleryDots({ total, activeIndex }: { total: number; activeIndex: number }) {
  if (total <= 1) return null;
  return <div className="gallery-dots" aria-label={`共 ${total} 张图片，当前第 ${activeIndex + 1} 张`}>
    {Array.from({ length: total }, (_, index) => <span key={index} className={index === activeIndex ? "active" : ""} />)}
  </div>;
}

function RouteCard({ event, onOpen, showLineAge = false }: { event: RouteEvent; onOpen: () => void; showLineAge?: boolean }) {
  const areaText = event.areas.length ? event.areas.join("、") : "区域待确认";
  const difficulty = [event.gradeSystem, event.gradeRange].filter(Boolean).join(" ") || "难度待确认";
  const status = actionStatus(event);
  return <button className="route-card" type="button" onClick={onOpen} aria-label={`查看${event.gymName}换线详情`}>
    <div className={`wall-wrap wall-${status.key} ${event.images[0] ? "has-image" : ""}`}>
      {event.images[0] && <WallPreview image={event.images[0]} gymName={event.gymName} />}
      <span className={`wall-label action-status ${status.key}`}>{showLineAge && event.openingAt ? relativeOpeningText(event.openingAt, "past") : status.text}</span>
      <span className="grade-badge">{difficulty}</span>
    </div>
    <div className="route-card-body">
      <h3>{event.gymName}</h3>
      <p className="route-card-meta">{event.city} · {areaText} · {event.routeCount === null ? "路线待确认" : `${event.routeCount} 条路线`}</p>
      <div className="route-card-timeline" aria-label="换线时间安排">
        {event.dismantleAt && <p className="dismantle"><i aria-hidden="true" /><span>拆线时间</span><strong>{formatDateTime(event.dismantleAt)}</strong></p>}
        <p className="construction"><i aria-hidden="true" /><span>换线时间</span><strong>{event.constructionStartAt ? formatDateTime(event.constructionStartAt) : "待确认"}</strong></p>
        <p className="opening"><i aria-hidden="true" /><span>新线开放时间</span><strong>{event.openingAt ? formatDateTime(event.openingAt) : "待确认"}</strong></p>
      </div>
    </div>
  </button>;
}

function DetailWall({
  event,
  activeImageIndex,
  onImageIndexChange,
  onOpen,
}: {
  event: RouteEvent;
  activeImageIndex: number;
  onImageIndexChange: (index: number) => void;
  onOpen: (index: number) => void;
}) {
  const status = actionStatus(event);
  const difficulty = [event.gradeSystem, event.gradeRange].filter(Boolean).join(" ") || "难度待确认";
  const content = <>
    <span className={`wall-label action-status ${status.key}`}>{status.text}</span>
    <span className="grade-badge">{difficulty}</span>
  </>;
  return event.images.length > 0 ? (
    <div className={`detail-wall wall-${status.key} has-image`}>
      <div className="detail-image-carousel" aria-label="现场图片，可左右滑动" onScroll={(event) => updateImageIndex(event.currentTarget, onImageIndexChange)}>
        {event.images.map((image, index) => <button key={`${image.url}-${index}`} className="detail-image-slide" type="button" onClick={() => onOpen(index)} aria-label={`查看第 ${index + 1} 张现场图片`}><WallPreview image={image} gymName={event.gymName} /></button>)}
      </div>
      {content}
      <GalleryDots total={event.images.length} activeIndex={activeImageIndex} />
    </div>
  ) : (
    <div className={`detail-wall wall-${status.key}`}>{content}</div>
  );
}

function App() {
  const [data, setData] = useState<RouteCalendarResponse | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>(initialTab);
  const [routeMode, setRouteMode] = useState<"upcoming" | "recent">("upcoming");
  const [month, setMonth] = useState(startOfMonth(today));
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [city, setCity] = useState("");
  const [gymQuery, setGymQuery] = useState("");
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);
  const [pendingAreas, setPendingAreas] = useState<string[]>([]);
  const [areaMenuOpen, setAreaMenuOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [cityMenuOpen, setCityMenuOpen] = useState(false);
  const [citySearch, setCitySearch] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<RouteEvent | null>(null);
  const [activeGymId, setActiveGymId] = useState(initialGymId);
  const [gymCity, setGymCity] = useState("");
  const [gymCityMenuOpen, setGymCityMenuOpen] = useState(false);
  const [gymCitySearch, setGymCitySearch] = useState("");
  const [gymSearch, setGymSearch] = useState("");
  const [gymMonth, setGymMonth] = useState(startOfMonth(today));
  const [gymSelectedDate, setGymSelectedDate] = useState<string | null>(null);
  const [detailImageIndex, setDetailImageIndex] = useState(0);
  const [previewImageIndex, setPreviewImageIndex] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const citySelectRef = useRef<HTMLDivElement>(null);
  const areaSelectRef = useRef<HTMLDivElement>(null);
  const gymCitySelectRef = useRef<HTMLDivElement>(null);
  const previewCarouselRef = useRef<HTMLDivElement>(null);
  const urlStateRestoredRef = useRef(false);

  useEffect(() => {
    const controllers = new Set<AbortController>();
    const loadEvents = (showLoading: boolean) => {
      const controller = new AbortController();
      controllers.add(controller);
      if (showLoading) setState("loading");
      fetchAllEvents(controller.signal)
        .then((result) => { if (!controller.signal.aborted) { setData(result); setState("ready"); } })
        .catch(() => { if (!controller.signal.aborted && showLoading) setState("error"); })
        .finally(() => controllers.delete(controller));
    };
    loadEvents(true);
    const refreshTimer = window.setInterval(() => loadEvents(false), 60_000);
    return () => { window.clearInterval(refreshTimer); controllers.forEach((controller) => controller.abort()); };
  }, []);

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      if (citySelectRef.current && !citySelectRef.current.contains(event.target as Node)) setCityMenuOpen(false);
      if (areaSelectRef.current && !areaSelectRef.current.contains(event.target as Node)) setAreaMenuOpen(false);
      if (gymCitySelectRef.current && !gymCitySelectRef.current.contains(event.target as Node)) setGymCityMenuOpen(false);
    };
    document.addEventListener("mousedown", closeMenus);
    return () => document.removeEventListener("mousedown", closeMenus);
  }, []);

  useEffect(() => {
    const restoreUrlState = () => {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get("tab") === "gyms" ? "gyms" : "routes";
      setActiveTab(tab);
      setActiveGymId(params.get("gym") ?? "");
      const linkedEvent = tab === "routes" ? data?.items.find((event) => event.id === params.get("event")) : null;
      if (linkedEvent) {
        const opening = linkedEvent.openingAt ? new Date(linkedEvent.openingAt) : null;
        setCity(linkedEvent.city);
        if (opening && !Number.isNaN(opening.getTime())) setMonth(startOfMonth(opening));
        setSelectedDate(eventDate(linkedEvent.openingAt));
      }
    };
    if (data && !urlStateRestoredRef.current) {
      restoreUrlState();
      urlStateRestoredRef.current = true;
    }
    window.addEventListener("popstate", restoreUrlState);
    return () => window.removeEventListener("popstate", restoreUrlState);
  }, [data]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (previewImageIndex !== null) setPreviewImageIndex(null);
      else if (selectedEvent) setSelectedEvent(null);
      else if (cityMenuOpen) setCityMenuOpen(false);
      else if (gymCityMenuOpen) setGymCityMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [cityMenuOpen, gymCityMenuOpen, previewImageIndex, selectedEvent]);

  useEffect(() => {
    if (previewImageIndex === null || !previewCarouselRef.current) return;
    previewCarouselRef.current.scrollTo({ left: previewCarouselRef.current.clientWidth * previewImageIndex, behavior: "auto" });
  }, [previewImageIndex]);

  useEffect(() => {
    if (!selectedEvent) return;
    const bodyOverflow = document.body.style.overflow;
    const rootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = rootOverflow;
    };
  }, [selectedEvent]);

  const allItems = useMemo(() => (data?.items ?? []).filter((event) => event.planStatus !== "取消"), [data?.items]);
  const selectedCityItems = useMemo(() => allItems.filter((event) => !city || event.city === city), [allItems, city]);
  const cityCounts = useMemo(() => new Map((data?.filters.cities ?? []).map((name) => [name, allItems.filter((event) => event.city === name).length])), [allItems, data?.filters.cities]);
  const matchingCities = useMemo(() => (data?.filters.cities ?? []).filter((name) => name.includes(citySearch.trim())), [citySearch, data?.filters.cities]);
  const monthItems = useMemo(() => selectedCityItems.filter((event) => eventOverlapsMonth(event, month)), [selectedCityItems, month]);
  const undatedItems = useMemo(() => selectedCityItems.filter((event) => !eventStartDate(event)), [selectedCityItems]);
  const recentItems = useMemo(() => {
    const disruptedGyms = new Set(selectedCityItems.flatMap((event) => {
      const opening = eventDate(event.openingAt);
      const disruption = eventDisruptionDate(event);
      return opening && opening > todayKey && disruption && disruption <= todayKey ? [event.gymId ?? `${event.city}::${event.gymName}`] : [];
    }));
    return latestOpenedByGym(selectedCityItems).filter((event) => !disruptedGyms.has(event.gymId ?? `${event.city}::${event.gymName}`));
  }, [selectedCityItems]);
  const upcomingItems = useMemo(() => [...monthItems.filter((event) => !event.openingAt || (eventDate(event.openingAt) ?? "") >= todayKey), ...undatedItems], [monthItems, undatedItems]);
  const listItems = useMemo(() => selectedDate
    ? selectedCityItems.filter((event) => eventForDate(event, selectedDate))
    : routeMode === "recent" ? recentItems : upcomingItems,
  [recentItems, routeMode, selectedCityItems, selectedDate, upcomingItems]);
  const filteredListItems = useMemo(() => {
    const query = gymQuery.trim().toLocaleLowerCase();
    return listItems
      .filter((event) => !query || event.gymName.toLocaleLowerCase().includes(query))
      .filter((event) => selectedAreas.length === 0 || event.areas.some((area) => selectedAreas.includes(area)));
  }, [gymQuery, listItems, selectedAreas]);
  const days = datesForMonth(month);
  const selectedCityLabel = city || "全国";
  const areaLabel = selectedAreas.length === 0 ? "换线区域" : selectedAreas.length === 1 ? selectedAreas[0] : `${selectedAreas[0]} +${selectedAreas.length - 1}`;
  const gyms = data?.gyms ?? [];
  const selectedGym = gyms.find((gym) => gym.id === activeGymId) ?? null;
  const gymCityCounts = useMemo(() => new Map((data?.filters.gymCities ?? []).map((name) => [name, gyms.filter((gym) => gym.city === name).length])), [data?.filters.gymCities, gyms]);
  const matchingGymCities = useMemo(() => (data?.filters.gymCities ?? []).filter((name) => name.includes(gymCitySearch.trim())), [data?.filters.gymCities, gymCitySearch]);
  const matchingGyms = useMemo(() => {
    const query = gymSearch.trim().toLocaleLowerCase();
    return gyms.filter((gym) => (!gymCity || gym.city === gymCity)
      && (!query || [gym.name, ...gym.aliases].join(" ").toLocaleLowerCase().includes(query)));
  }, [gymCity, gymSearch, gyms]);
  const selectedGymEvents = useMemo(() => allItems.filter((event) => event.gymId === activeGymId), [activeGymId, allItems]);
  const lastGymOpening = useMemo(() => selectedGymEvents
    .filter((event) => event.openingAt && (eventDate(event.openingAt) ?? "") <= todayKey)
    .sort((a, b) => (eventDate(b.openingAt) ?? "").localeCompare(eventDate(a.openingAt) ?? ""))[0] ?? null, [selectedGymEvents]);
  const nextGymOpening = useMemo(() => selectedGymEvents
    .filter((event) => event.openingAt && (eventDate(event.openingAt) ?? "") > todayKey)
    .sort((a, b) => (eventDate(a.openingAt) ?? "").localeCompare(eventDate(b.openingAt) ?? ""))[0] ?? null, [selectedGymEvents]);
  const gymUnderConstruction = Boolean(nextGymOpening && eventDisruptionDate(nextGymOpening) && eventDisruptionDate(nextGymOpening)! <= todayKey);
  const gymMonthItems = useMemo(() => selectedGymEvents.filter((event) => eventOverlapsMonth(event, gymMonth)), [gymMonth, selectedGymEvents]);
  const gymDays = datesForMonth(gymMonth);

  function selectCity(nextCity: string) {
    setCity(nextCity);
    setSelectedDate(null);
    setSelectedAreas([]);
    setPendingAreas([]);
    setAreaMenuOpen(false);
    setGymQuery("");
    setCitySearch("");
    setCityMenuOpen(false);
  }

  function moveMonth(offset: number) {
    setMonth(new Date(month.getFullYear(), month.getMonth() + offset, 1));
    setSelectedDate(null);
  }

  function togglePendingArea(area: string) {
    setPendingAreas((areas) => areas.includes(area) ? areas.filter((item) => item !== area) : [...areas, area]);
  }

  function switchTab(tab: AppTab) {
    setActiveTab(tab);
    setSelectedEvent(null);
    updateUrl(tab, tab === "gyms" ? activeGymId || undefined : undefined);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openGym(gym: PartnerGym) {
    setActiveGymId(gym.id);
    setGymCity(gym.city);
    setGymSearch("");
    setGymSelectedDate(null);
    setActiveTab("gyms");
    setSelectedEvent(null);
    updateUrl("gyms", gym.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function selectGymCity(nextCity: string) {
    setGymCity(nextCity);
    setGymCitySearch("");
    setGymCityMenuOpen(false);
  }

  function showEventInRoutes(event: RouteEvent) {
    const opening = event.openingAt ? new Date(event.openingAt) : null;
    setCity(event.city);
    setMonth(opening && !Number.isNaN(opening.getTime()) ? startOfMonth(opening) : month);
    setSelectedDate(eventDate(event.openingAt));
    setGymQuery("");
    setSelectedAreas([]);
    setActiveTab("routes");
    setSelectedEvent(null);
    updateUrl("routes", undefined, event.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return <main className="app-shell">
    <header className="hero" aria-labelledby="page-title">
      <div className="brand-row"><span className="brand-mark"><span className="brand-icon"><Mountain size={17} /></span>ROUTE UPDATE CALENDAR</span></div>
      <h1 id="page-title">攀岩日历</h1>
      <p>{activeTab === "routes" ? "发现全城近期新线，提前避开施工区域，锁定开放时间。" : "选择一家合作岩馆，查看场馆资料和它的换线时间线。"}</p>
    </header>

    <nav className="view-tabs panel" aria-label="日历视图">
      <button type="button" className={activeTab === "routes" ? "active" : ""} aria-current={activeTab === "routes" ? "page" : undefined} onClick={() => switchTab("routes")}><Sparkles size={16} />新线日历</button>
      <button type="button" className={activeTab === "gyms" ? "active" : ""} aria-current={activeTab === "gyms" ? "page" : undefined} onClick={() => switchTab("gyms")}><Store size={16} />岩馆日历</button>
    </nav>

    {activeTab === "routes" && <>
    <section className="panel filters" aria-label="筛选岩馆换线安排">
      <div className="filter-caption"><strong>城市筛选</strong><span>选择后刷新安排</span></div>
      <div className="city-select" ref={citySelectRef}>
        <button className="city-trigger" type="button" aria-expanded={cityMenuOpen} aria-controls="city-menu" onClick={() => { setCityMenuOpen((open) => !open); setCitySearch(""); }}>
          <span><Navigation size={15} />{selectedCityLabel}</span><ChevronDown className={cityMenuOpen ? "rotated" : ""} size={16} />
        </button>
        {cityMenuOpen && <div id="city-menu" className="city-menu" role="listbox" aria-label="城市列表">
          <label className="city-search"><Search size={15} aria-hidden="true" /><input autoFocus value={citySearch} onChange={(event) => setCitySearch(event.target.value)} placeholder="搜索城市" aria-label="搜索城市" /></label>
          <button className={`city-option ${!city ? "active" : ""}`} type="button" role="option" aria-selected={!city} onClick={() => selectCity("")}><span>全国</span><small>{allItems.length} 个计划</small>{!city && <Check size={16} />}</button>
          {matchingCities.map((item) => <button key={item} className={`city-option ${city === item ? "active" : ""}`} type="button" role="option" aria-selected={city === item} onClick={() => selectCity(item)}><span>{item}</span><small>{cityCounts.get(item) ?? 0} 个计划</small>{city === item && <Check size={16} />}</button>)}
          {citySearch && matchingCities.length === 0 && <p className="city-empty">未找到匹配城市</p>}
        </div>}
      </div>
    </section>

    <section className="panel calendar-card" aria-labelledby="calendar-title">
      <div className="calendar-header">
        <div className="calendar-title-row">
          <button type="button" className="month-nav" aria-label="上个月" onClick={() => moveMonth(-1)}><ChevronLeft size={17} /></button>
          <h2 id="calendar-title">{monthLabel(month)}</h2>
          <button type="button" className="month-nav" aria-label="下个月" onClick={() => moveMonth(1)}><ChevronRight size={17} /></button>
        </div>
        {!calendarExpanded && <div className="calendar-subtitle-row">
          <p>本月有 {gymCount(monthItems)} 家岩馆安排换线</p>
          <button className="calendar-toggle" type="button" aria-expanded="false" onClick={() => setCalendarExpanded(true)}>展开<ChevronDown size={14} /></button>
        </div>}
      </div>
      {calendarExpanded && <>
        <div className="phase-legend" aria-label="日历图例"><span className="opening"><i />新线开放（数字表示岩馆数）</span></div>
        <div className="weekday-grid" aria-hidden="true">{weekdayLabels.map((day) => <span key={day}>{day}</span>)}</div>
        <div className="calendar-grid" role="grid" aria-label={`${monthLabel(month)}月历`}>
          {days.map((day) => {
            const key = dateKey(day);
            const inMonth = day.getMonth() === month.getMonth();
            const openingCount = gymCount(selectedCityItems.filter((event) => eventForDate(event, key)));
            const selected = selectedDate === key;
            const description = openingCount ? `新线开放 ${openingCount} 家` : "";
            return <button key={key} type="button" role="gridcell" aria-label={description ? `${key}，${description}` : key} className={`day ${inMonth ? "" : "muted"} ${!inMonth && openingCount ? "outside-event" : ""} ${openingCount ? "event" : ""} ${selected ? "selected" : ""} ${key === todayKey ? "today" : ""}`} onClick={() => (inMonth || openingCount > 0) && setSelectedDate(selected ? null : key)}>
              <span className="num">{day.getDate()}</span>
              {openingCount > 0 && <span className="opening-count" aria-hidden="true">{openingCount}</span>}
            </button>;
          })}
        </div>
        <button className="calendar-toggle calendar-collapse" type="button" aria-expanded="true" onClick={() => setCalendarExpanded(false)}>收起<ChevronDown className="rotated" size={14} /></button>
      </>}
    </section>

    <section className="schedule-section" aria-labelledby="schedule-title">
      <div className="section-head"><div><p className="section-eyebrow">{selectedDate ? selectedDate.replaceAll("-", ".") : routeMode === "recent" ? "基于已发布记录" : monthLabel(month)}</p><h2 id="schedule-title">{selectedDate ? "当日安排" : "换线动态"}</h2></div>{selectedDate && <button className="clear-date" onClick={() => setSelectedDate(null)}>查看全月<X size={15} /></button>}</div>
      {!selectedDate && <div className="route-mode" role="tablist" aria-label="换线动态范围"><button type="button" role="tab" aria-selected={routeMode === "upcoming"} className={routeMode === "upcoming" ? "active" : ""} onClick={() => setRouteMode("upcoming")}><CalendarDays size={15} />即将开放</button><button type="button" role="tab" aria-selected={routeMode === "recent"} className={routeMode === "recent" ? "active" : ""} onClick={() => setRouteMode("recent")}><Check size={15} />近期已开放</button></div>}
      <div className="schedule-filters" aria-label="筛选当前换线安排">
        <div className="area-select" ref={areaSelectRef}>
          <button className={`area-trigger ${selectedAreas.length ? "active" : ""}`} type="button" aria-expanded={areaMenuOpen} aria-controls="area-menu" onClick={() => areaMenuOpen ? setAreaMenuOpen(false) : (setPendingAreas(selectedAreas), setAreaMenuOpen(true))}><Filter size={16} /><span>{areaLabel}</span></button>
          {areaMenuOpen && <div id="area-menu" className="area-menu" role="listbox" aria-label="换线区域筛选" aria-multiselectable="true"><div className="area-menu-title"><span>换线区域</span><button type="button" onClick={() => setPendingAreas([])}>清除</button></div><div className="area-options">{(data?.filters.areas ?? []).map((area) => <label key={area} className="area-option"><input type="checkbox" checked={pendingAreas.includes(area)} onChange={() => togglePendingArea(area)} /><span>{area}</span></label>)}</div><button className="area-confirm" type="button" onClick={() => { setSelectedAreas(pendingAreas); setAreaMenuOpen(false); }}>确认{pendingAreas.length ? `（${pendingAreas.length}）` : ""}</button></div>}
        </div>
        <label className="schedule-search"><Search size={18} aria-hidden="true" /><input value={gymQuery} onChange={(event) => setGymQuery(event.target.value)} type="search" placeholder="搜索岩馆名称" aria-label="搜索岩馆名称" />{gymQuery && <button type="button" onClick={() => setGymQuery("")} aria-label="清除岩馆搜索"><X size={16} /></button>}</label>
      </div>
      {state === "loading" && <div className="status">正在加载公开换线安排...</div>}
      {state === "error" && <div className="status error">暂时无法获取换线安排，请稍后重试。</div>}
      {state === "ready" && filteredListItems.length === 0 && <div className="status">当前条件下暂无已发布的换线安排</div>}
      {state === "ready" && filteredListItems.map((event) => <RouteCard key={event.id} event={event} showLineAge={!selectedDate && routeMode === "recent"} onOpen={() => { setDetailImageIndex(0); setSelectedEvent(event); }} />)}
    </section>
    </>}

    {activeTab === "gyms" && <section className="gym-view" aria-labelledby="gym-view-title">
      {!selectedGym ? <>
        <div className="section-head gym-directory-head"><div><p className="section-eyebrow">合作岩馆</p><h2 id="gym-view-title">找一家岩馆</h2></div><span>{matchingGyms.length} 家</span></div>
        <div className="panel gym-filters">
          <div className="gym-city-select" ref={gymCitySelectRef}>
            <button className={`gym-city-trigger ${gymCity ? "active" : ""}`} type="button" aria-expanded={gymCityMenuOpen} aria-controls="gym-city-menu" onClick={() => { setGymCityMenuOpen((open) => !open); setGymCitySearch(""); }}><span><Navigation size={16} />{gymCity || "全国"}</span><ChevronDown className={gymCityMenuOpen ? "rotated" : ""} size={15} /></button>
            {gymCityMenuOpen && <div id="gym-city-menu" className="city-menu gym-city-menu" role="listbox" aria-label="岩馆城市列表">
              <label className="city-search"><Search size={15} aria-hidden="true" /><input autoFocus value={gymCitySearch} onChange={(event) => setGymCitySearch(event.target.value)} placeholder="搜索城市" aria-label="搜索岩馆城市" /></label>
              <button className={`city-option ${!gymCity ? "active" : ""}`} type="button" role="option" aria-selected={!gymCity} onClick={() => selectGymCity("")}><span>全国</span><small>{gyms.length} 家</small>{!gymCity && <Check size={16} />}</button>
              {matchingGymCities.map((name) => <button key={name} className={`city-option ${gymCity === name ? "active" : ""}`} type="button" role="option" aria-selected={gymCity === name} onClick={() => selectGymCity(name)}><span>{name}</span><small>{gymCityCounts.get(name) ?? 0} 家</small>{gymCity === name && <Check size={16} />}</button>)}
              {gymCitySearch && matchingGymCities.length === 0 && <p className="city-empty">未找到匹配城市</p>}
            </div>}
          </div>
          <label className="schedule-search"><Search size={18} aria-hidden="true" /><input value={gymSearch} onChange={(event) => setGymSearch(event.target.value)} type="search" placeholder="搜索岩馆或别名" aria-label="搜索岩馆或别名" />{gymSearch && <button type="button" onClick={() => setGymSearch("")} aria-label="清除岩馆搜索"><X size={16} /></button>}</label>
        </div>
        {state === "loading" && <div className="status">正在加载合作岩馆...</div>}
        {state === "error" && <div className="status error">暂时无法获取合作岩馆，请稍后重试。</div>}
        {state === "ready" && matchingGyms.length === 0 && <div className="status">没有找到匹配的有效合作岩馆</div>}
        {state === "ready" && <div className="gym-list">{matchingGyms.map((gym, index) => {
          const eventCount = allItems.filter((event) => event.gymId === gym.id).length;
          return <button key={gym.id} type="button" className="gym-list-item" onClick={() => openGym(gym)}>
            <span className={`gym-color color-${index % 5}`}><Mountain size={17} /></span>
            <span className="gym-list-copy"><strong>{gym.name}</strong><small>{[gym.city, gym.district].filter(Boolean).join(" · ")}</small></span>
            <span className="gym-event-count">{eventCount ? `${eventCount} 条公开安排` : "暂无公开安排"}</span><ChevronRight size={17} />
          </button>;
        })}</div>}
      </> : <>
        <button type="button" className="change-gym" onClick={() => { setActiveGymId(""); updateUrl("gyms"); }}><ChevronLeft size={16} />更换岩馆</button>
        <article className="panel gym-profile">
          <div className="gym-profile-top"><span className="gym-profile-icon"><Mountain size={22} /></span><div><p>{[selectedGym.city, selectedGym.district].filter(Boolean).join(" · ")}</p><h2 id="gym-view-title">{selectedGym.name}</h2></div></div>
          {selectedGym.aliases.length > 0 && <p className="gym-alias">别名：{selectedGym.aliases.join("、")}</p>}
          <div className="gym-facts">
            {selectedGym.address && <div><span>地址</span><strong>{selectedGym.address}</strong></div>}
            {selectedGym.disciplines.length > 0 && <div><span>场馆项目</span><strong>{selectedGym.disciplines.join("、")}</strong></div>}
            {selectedGym.gradeSystems.length > 0 && <div><span>难度体系</span><strong>{selectedGym.gradeSystems.join("、")}</strong></div>}
          </div>
          {selectedGym.homepageUrl && <a className="gym-homepage" href={selectedGym.homepageUrl} target="_blank" rel="noreferrer">预约或查看主页<ExternalLink size={15} /></a>}
        </article>

        <section className="gym-pulse" aria-label="岩馆换线状态">
          <div className={`gym-status-banner ${gymUnderConstruction ? "construction" : lastGymOpening ? "open" : "empty"}`}>
            <span>{gymUnderConstruction ? "施工中" : lastGymOpening?.openingAt ? relativeOpeningText(lastGymOpening.openingAt, "past") : "暂无已发布换线记录"}</span>
            <small>{gymUnderConstruction && nextGymOpening?.openingAt ? `预计 ${formatDateTime(nextGymOpening.openingAt)} 开放` : "按已发布的新线开放时间计算"}</small>
          </div>
          <div className="gym-date-summary">
            <div><span>上次新线开放</span><strong>{lastGymOpening?.openingAt ? formatDateTime(lastGymOpening.openingAt) : "暂无记录"}</strong><small>{lastGymOpening?.openingAt && relativeOpeningText(lastGymOpening.openingAt, "past")}</small></div>
            <div><span>下次新线开放</span><strong>{nextGymOpening?.openingAt ? formatDateTime(nextGymOpening.openingAt) : "尚未公布"}</strong><small>{nextGymOpening?.openingAt && relativeOpeningText(nextGymOpening.openingAt, "future")}</small></div>
          </div>
        </section>

        <section className="panel calendar-card gym-calendar" aria-labelledby="gym-calendar-title">
          <div className="calendar-title-row">
            <button type="button" className="month-nav" aria-label="上个月" onClick={() => { setGymMonth(new Date(gymMonth.getFullYear(), gymMonth.getMonth() - 1, 1)); setGymSelectedDate(null); }}><ChevronLeft size={17} /></button>
            <h2 id="gym-calendar-title">{monthLabel(gymMonth)}</h2>
            <button type="button" className="month-nav" aria-label="下个月" onClick={() => { setGymMonth(new Date(gymMonth.getFullYear(), gymMonth.getMonth() + 1, 1)); setGymSelectedDate(null); }}><ChevronRight size={17} /></button>
          </div>
          <div className="phase-legend"><span className="opening"><i />新线开放</span></div>
          <div className="weekday-grid" aria-hidden="true">{weekdayLabels.map((day) => <span key={day}>{day}</span>)}</div>
          <div className="calendar-grid" role="grid" aria-label={`${selectedGym.name}${monthLabel(gymMonth)}日历`}>
            {gymDays.map((day) => {
              const key = dateKey(day);
              const inMonth = day.getMonth() === gymMonth.getMonth();
              const eventCount = selectedGymEvents.filter((event) => eventForDate(event, key)).length;
              const selected = gymSelectedDate === key;
              return <button key={key} type="button" role="gridcell" aria-label={`${key}${eventCount ? `，${eventCount} 次新线开放` : ""}`} className={`day ${inMonth ? "" : "muted"} ${eventCount ? "event" : ""} ${selected ? "selected" : ""} ${key === todayKey ? "today" : ""}`} onClick={() => eventCount > 0 && setGymSelectedDate(selected ? null : key)}><span className="num">{day.getDate()}</span>{eventCount > 0 && <span className="opening-count">{eventCount}</span>}</button>;
            })}
          </div>
        </section>

        <section className="schedule-section gym-events" aria-labelledby="gym-events-title">
          <div className="section-head"><div><p className="section-eyebrow">{gymSelectedDate?.replaceAll("-", ".") ?? monthLabel(gymMonth)}</p><h2 id="gym-events-title">{gymSelectedDate ? "当日安排" : "本月安排"}</h2></div>{gymSelectedDate && <button className="clear-date" onClick={() => setGymSelectedDate(null)}>查看全月<X size={15} /></button>}</div>
          {(gymSelectedDate ? selectedGymEvents.filter((event) => eventForDate(event, gymSelectedDate)) : gymMonthItems).length === 0 && <div className="status">这个月暂无已发布的换线安排</div>}
          {(gymSelectedDate ? selectedGymEvents.filter((event) => eventForDate(event, gymSelectedDate)) : gymMonthItems).map((event) => <RouteCard key={event.id} event={event} onOpen={() => { setDetailImageIndex(0); setSelectedEvent(event); }} />)}
        </section>
      </>}
    </section>}

    {selectedEvent && <div className="sheet-backdrop" role="presentation" onClick={() => setSelectedEvent(null)}>
      <aside className="detail-sheet" role="dialog" aria-modal="true" aria-label={`${selectedEvent.gymName}详情`} onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" /><button className="sheet-close" onClick={() => setSelectedEvent(null)} aria-label="关闭详情"><X size={21} /></button>
        <DetailWall key={selectedEvent.id} event={selectedEvent} activeImageIndex={detailImageIndex} onImageIndexChange={setDetailImageIndex} onOpen={setPreviewImageIndex} />
        <div className="sheet-body">
          <div className="sheet-topline"><p className="sheet-city"><MapPin size={15} />{selectedEvent.city}</p>{selectedEvent.planStatus === "变更" && <span className="plan-tag changed">计划变更</span>}</div>
          <h2>{selectedEvent.gymName}</h2>
          <p className={`detail-date-line ${actionStatus(selectedEvent).key}`}><i aria-hidden="true" />{selectedEvent.dismantleAt && <>拆线 {formatDateTime(selectedEvent.dismantleAt)} · </>}换线 {selectedEvent.constructionStartAt ? formatDateTime(selectedEvent.constructionStartAt) : "待确认"} · 开放 {selectedEvent.openingAt ? formatDateTime(selectedEvent.openingAt) : "待确认"}</p>
          <div className="detail-rows"><div><span>换线区域</span><strong>{selectedEvent.areas.length ? selectedEvent.areas.join("、") : "待确认"}</strong></div><div><span>更新路线</span><strong>{selectedEvent.routeCount === null ? "待确认" : `${selectedEvent.routeCount} 条路线`}</strong></div><div><span>难度范围</span><strong>{[selectedEvent.gradeSystem, selectedEvent.gradeRange].filter(Boolean).join(" ") || "待确认"}</strong></div></div>
          {selectedEvent.areaNote && <section className="detail-callout detail-note" aria-label="区域说明"><h3><Wrench size={15} />区域说明</h3><p>{selectedEvent.areaNote}</p></section>}
          {selectedEvent.highlights && <section className="detail-callout detail-tip" aria-label="主题亮点"><h3><Sparkles size={15} />主题亮点</h3><p>{selectedEvent.highlights}</p></section>}
          {activeTab === "routes" && selectedEvent.gymId && gyms.find((gym) => gym.id === selectedEvent.gymId) && <button className="detail-primary-action" type="button" onClick={() => openGym(gyms.find((gym) => gym.id === selectedEvent.gymId)!)}><Store size={16} />查看岩馆日历<ArrowRight size={16} /></button>}
          {activeTab === "gyms" && <button className="detail-primary-action" type="button" onClick={() => showEventInRoutes(selectedEvent)}><Sparkles size={16} />在新线日历中查看<ArrowRight size={16} /></button>}
        </div>
      </aside>
    </div>}
    {previewImageIndex !== null && selectedEvent && <div className="image-backdrop" role="presentation" onClick={() => setPreviewImageIndex(null)}><button className="image-close" aria-label="关闭图片预览"><X size={22} /></button><div className="image-preview" onClick={(event) => event.stopPropagation()}><div className="image-carousel" ref={previewCarouselRef} onScroll={(event) => updateImageIndex(event.currentTarget, setPreviewImageIndex)} aria-label="放大现场图片，可左右滑动">{selectedEvent.images.map((image, index) => <img key={`${image.url}-${index}`} src={image.url} alt={image.name ?? `${selectedEvent.gymName}现场图片 ${index + 1}`} />)}</div><GalleryDots total={selectedEvent.images.length} activeIndex={previewImageIndex} /></div></div>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
