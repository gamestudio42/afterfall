import { useUi } from "../app/store";
import { BottomBar } from "../components/BottomBar";
import { HelpModal } from "../components/Help";
import { Minimap } from "../components/Minimap";
import { Alerts, Banner, DevOverlay, DragRect, EventModal, OutcomeModal, Toast } from "../components/Overlays";
import { SidePanel } from "../components/SidePanel";
import { TopBar } from "../components/TopBar";

export function GameScreen() {
  const showHelp = useUi((s) => s.showHelp);
  return (
    <div className="hud">
      <TopBar />
      <Banner />
      <Alerts />
      <SidePanel />
      <Minimap />
      <BottomBar />
      <DragRect />
      <DevOverlay />
      <EventModal />
      <OutcomeModal />
      <Toast />
      {showHelp && <HelpModal />}
    </div>
  );
}
