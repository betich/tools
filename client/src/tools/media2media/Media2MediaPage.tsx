import { Navigate, NavLink, useParams } from "react-router-dom";
import { PageHead, Shell } from "@/components/Shell";
import { cn } from "@/lib/cn";
import { GifTab } from "./GifTab";
import { ImageTab } from "./ImageTab";
import { isTab, tabs, type TabId } from "./tabs";
import { VideoTab } from "./VideoTab";

const NOTE =
  "Convert images, video and GIFs. Every codec runs in this browser, on your own hardware — nothing is uploaded.";

/**
 * Everything runs in the browser, so this page never waits on the server.
 *
 * Image and video are benches — in, the machine, out — on a scrolling page;
 * video takes the wide measure because its source is a picture you work on.
 * The GIF composer is a room: from a laptop up it takes exactly the viewport,
 * the tab strip moves into its toolbar, and the page itself never scrolls.
 */
export function Media2MediaPage() {
  const { tab } = useParams();
  if (!isTab(tab)) return <Navigate to="/media2media/image" replace />;

  if (tab === "gif") {
    return (
      <Shell width="workspace">
        <header className="border-hairline-faint mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-b pb-4 lg:mb-0 lg:shrink-0 lg:px-6 lg:py-3.5 xl:px-7">
          <h1 className="text-ink text-title shrink-0 font-mono font-bold uppercase">media2media</h1>
          <span className="text-meta text-small hidden font-mono sm:inline" aria-hidden>
            /
          </span>
          <TabStrip current={tab} />
          <p className="text-label text-body hidden font-sans normal-case xl:ml-auto xl:block">
            Compose frames on the timeline; it plays as you go.
          </p>
        </header>
        <GifTab />
      </Shell>
    );
  }

  const Body = tab === "video" ? VideoTab : ImageTab;
  return (
    <Shell width={tab === "video" ? "wide" : "page"}>
      <PageHead title="media2media" note={NOTE} />
      <TabStrip current={tab} rule="-bottom-[13px]" className="border-hairline-faint mb-10 border-b pb-3" />
      <Body />
    </Shell>
  );
}

/** `rule`: where the active underline sits — on the nav's hairline, or just under the word in the toolbar. */
function TabStrip({ current, rule = "-bottom-1.5", className }: { current: TabId; rule?: string; className?: string }) {
  return (
    <nav aria-label="media type" className={cn("flex items-center gap-6", className)}>
      {tabs.map((t) => (
        <NavLink
          key={t.id}
          to={`/media2media/${t.id}`}
          replace
          aria-current={t.id === current ? "page" : undefined}
          className={cn(
            "text-micro relative font-mono uppercase transition-colors duration-200",
            "focus-visible:outline-indigo focus-visible:outline-1",
            t.id === current ? "text-ink" : "text-meta hover:text-indigo",
          )}
        >
          {t.label}
          {t.id === current ? <span className={cn("bg-indigo absolute left-0 h-px w-full", rule)} aria-hidden /> : null}
        </NavLink>
      ))}
    </nav>
  );
}
