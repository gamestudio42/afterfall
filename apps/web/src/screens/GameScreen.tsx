import { useUi } from "../app/store";
import { BottomBar } from "../components/BottomBar";
import { HelpModal } from "../components/Help";
import { EconomyModal, ResearchModal } from "../components/Research";
import { MapCredit } from "../components/MapCredit";
import { Minimap } from "../components/Minimap";
import { Alerts, Banner, DevOverlay, DragRect, EventModal, OutcomeModal, Toast } from "../components/Overlays";
import { SidePanel } from "../components/SidePanel";
import { TopBar } from "../components/TopBar";

export function GameScreen() {
  const showHelp = useUi((s) => s.showHelp);
  const showResearch = useUi((s) => s.showResearch);
  const showEcon = useUi((s) => s.showEcon);
  return (
    <div className="hud">
      <TopBar />
      <Banner />
      <Alerts />
      <SidePanel />
      <Minimap />
      <MapCredit />
      <BottomBar />
      <DragRect />
      <DevOverlay />
      <EventModal />
      <OutcomeModal />
      <Toast />
      {showHelp && <HelpModal />}
      {showResearch && <ResearchModal />}
      {showEcon && <EconomyModal />}
    </div>
  );
}
