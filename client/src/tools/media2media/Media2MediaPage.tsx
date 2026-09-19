import { Navigate, NavLink, useParams } from "react-router-dom";
import { PageHead, Shell } from "@/components/Shell";
import { cn } from "@/lib/cn";
import { GifTab } from "./GifTab";
import { ImageTab } from "./ImageTab";
import { isTab, tabs, type TabId } from "./tabs";
import { VideoTab } from "./VideoTab";

const bodies: Record<TabId, () => React.JSX.Element> = {
  image: ImageTab,
  video: VideoTab,
  gif: GifTab,
};

/**
 * Everything runs in the browser, so this page never waits on the server.
 * The shell is only the heading and the tab strip; each tab owns its body.
 */
export function Media2MediaPage() {
  const { tab } = useParams();
  if (!isTab(tab)) return <Navigate to="/media2media/image" replace />;
  const Body = bodies[tab];

  return (
    <Shell width="page">
      <PageHead
        title="media2media"
        note="Convert images, video and GIFs. Every codec runs in this browser, on your own hardware — nothing is uploaded."
      />

      <nav aria-label="media type" className="border-hairline-faint mb-10 flex items-center gap-6 border-b pb-3">
        {tabs.map((t) => (
          <NavLink
            key={t.id}
            to={`/media2media/${t.id}`}
            replace
            className={({ isActive }) =>
              cn(
                "text-micro relative font-mono uppercase transition-colors duration-200",
                "focus-visible:outline-indigo focus-visible:outline-1",
                isActive ? "text-ink" : "text-meta hover:text-indigo",
              )
            }
          >
            {({ isActive }) => (
              <>
                {t.label}
                {isActive ? (
                  <span className="bg-indigo absolute -bottom-[13px] left-0 h-px w-full" aria-hidden />
                ) : null}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <Body />
    </Shell>
  );
}
