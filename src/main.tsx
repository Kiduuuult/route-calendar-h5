import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Construction,
  Filter,
  MapPin,
  Mountain,
  Navigation,
  Search,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { createRoot } from "react-dom/client";
import type { RouteCalendarResponse, RouteEvent, RouteImage } from "./shared/types";
import "./styles.css";

const weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"];
const today = new Date();
const todayKey = dateKey(today);

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

function updateImageIndex(element: HTMLDivElement | null, next: (index: number) => void) {
  if (!element?.clientWidth) return;
  next(Math.round(element.scrollLeft / element.clientWidth));
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

function RouteCard({ event, onOpen }: { event: RouteEvent; onOpen: () => void }) {
  const areaText = event.areas.length ? event.areas.join("、") : "区域待确认";
  const difficulty = [event.gradeSystem, event.gradeRange].filter(Boolean).join(" ") || "难度待确认";
  const status = actionStatus(event);
  return <button className="route-card" type="button" onClick={onOpen} aria-label={`查看${event.gymName}换线详情`}>
    <div className={`wall-wrap wall-${status.key} ${event.images[0] ? "has-image" : ""}`}>
      {event.images[0] && <WallPreview image={event.images[0]} gymName={event.gymName} />}
      <span className={`wall-label action-status ${status.key}`}>{status.text}</span>
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
  const [detailImageIndex, setDetailImageIndex] = useState(0);
  const [previewImageIndex, setPreviewImageIndex] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const citySelectRef = useRef<HTMLDivElement>(null);
  const areaSelectRef = useRef<HTMLDivElement>(null);
  const previewCarouselRef = useRef<HTMLDivElement>(null);

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
    };
    document.addEventListener("mousedown", closeMenus);
    return () => document.removeEventListener("mousedown", closeMenus);
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (previewImageIndex !== null) setPreviewImageIndex(null);
      else if (selectedEvent) setSelectedEvent(null);
      else if (cityMenuOpen) setCityMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [cityMenuOpen, previewImageIndex, selectedEvent]);

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
  const cityCounts = useMemo(() => new Map(data?.filters.cities.map((name) => [name, allItems.filter((event) => event.city === name).length]) ?? []), [allItems, data?.filters.cities]);
  const matchingCities = useMemo(() => (data?.filters.cities ?? []).filter((name) => name.includes(citySearch.trim())), [citySearch, data?.filters.cities]);
  const monthItems = useMemo(() => selectedCityItems.filter((event) => eventOverlapsMonth(event, month)), [selectedCityItems, month]);
  const undatedItems = useMemo(() => selectedCityItems.filter((event) => !eventStartDate(event)), [selectedCityItems]);
  const listItems = useMemo(() => selectedDate ? selectedCityItems.filter((event) => eventForDate(event, selectedDate)) : [...monthItems, ...undatedItems], [monthItems, selectedCityItems, selectedDate, undatedItems]);
  const filteredListItems = useMemo(() => {
    const query = gymQuery.trim().toLocaleLowerCase();
    return listItems
      .filter((event) => !query || event.gymName.toLocaleLowerCase().includes(query))
      .filter((event) => selectedAreas.length === 0 || event.areas.some((area) => selectedAreas.includes(area)));
  }, [gymQuery, listItems, selectedAreas]);
  const days = datesForMonth(month);
  const selectedCityLabel = city || "全国";
  const areaLabel = selectedAreas.length === 0 ? "换线区域" : selectedAreas.length === 1 ? selectedAreas[0] : `${selectedAreas[0]} +${selectedAreas.length - 1}`;

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

  return <main className="app-shell">
    <header className="hero" aria-labelledby="page-title">
      <div className="brand-row"><span className="brand-mark"><span className="brand-icon"><Mountain size={17} /></span>ROUTE UPDATE CALENDAR</span></div>
      <h1 id="page-title">岩馆换线日历</h1>
      <p>查看近期岩馆换线安排，提前避开施工区域，锁定新线开放时间。</p>
    </header>

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
      <div className="section-head"><div><p className="section-eyebrow">{selectedDate ? selectedDate.replaceAll("-", ".") : monthLabel(month)}</p><h2 id="schedule-title">{selectedDate ? "当日安排" : "本月换线安排"}</h2></div>{selectedDate && <button className="clear-date" onClick={() => setSelectedDate(null)}>查看全月<X size={15} /></button>}</div>
      <div className="schedule-filters" aria-label="筛选当前换线安排">
        <div className="area-select" ref={areaSelectRef}>
          <button className={`area-trigger ${selectedAreas.length ? "active" : ""}`} type="button" aria-expanded={areaMenuOpen} aria-controls="area-menu" onClick={() => areaMenuOpen ? setAreaMenuOpen(false) : (setPendingAreas(selectedAreas), setAreaMenuOpen(true))}><Filter size={16} /><span>{areaLabel}</span></button>
          {areaMenuOpen && <div id="area-menu" className="area-menu" role="listbox" aria-label="换线区域筛选" aria-multiselectable="true"><div className="area-menu-title"><span>换线区域</span><button type="button" onClick={() => setPendingAreas([])}>清除</button></div><div className="area-options">{data?.filters.areas.map((area) => <label key={area} className="area-option"><input type="checkbox" checked={pendingAreas.includes(area)} onChange={() => togglePendingArea(area)} /><span>{area}</span></label>)}</div><button className="area-confirm" type="button" onClick={() => { setSelectedAreas(pendingAreas); setAreaMenuOpen(false); }}>确认{pendingAreas.length ? `（${pendingAreas.length}）` : ""}</button></div>}
        </div>
        <label className="schedule-search"><Search size={18} aria-hidden="true" /><input value={gymQuery} onChange={(event) => setGymQuery(event.target.value)} type="search" placeholder="搜索岩馆名称" aria-label="搜索岩馆名称" />{gymQuery && <button type="button" onClick={() => setGymQuery("")} aria-label="清除岩馆搜索"><X size={16} /></button>}</label>
      </div>
      {state === "loading" && <div className="status">正在加载公开换线安排...</div>}
      {state === "error" && <div className="status error">暂时无法获取换线安排，请稍后重试。</div>}
      {state === "ready" && filteredListItems.length === 0 && <div className="status">当前条件下暂无已发布的换线安排</div>}
      {state === "ready" && filteredListItems.map((event) => <RouteCard key={event.id} event={event} onOpen={() => { setDetailImageIndex(0); setSelectedEvent(event); }} />)}
    </section>

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
        </div>
      </aside>
    </div>}
    {previewImageIndex !== null && selectedEvent && <div className="image-backdrop" role="presentation" onClick={() => setPreviewImageIndex(null)}><button className="image-close" aria-label="关闭图片预览"><X size={22} /></button><div className="image-preview" onClick={(event) => event.stopPropagation()}><div className="image-carousel" ref={previewCarouselRef} onScroll={(event) => updateImageIndex(event.currentTarget, setPreviewImageIndex)} aria-label="放大现场图片，可左右滑动">{selectedEvent.images.map((image, index) => <img key={`${image.url}-${index}`} src={image.url} alt={image.name ?? `${selectedEvent.gymName}现场图片 ${index + 1}`} />)}</div><GalleryDots total={selectedEvent.images.length} activeIndex={previewImageIndex} /></div></div>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
