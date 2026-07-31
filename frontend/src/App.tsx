import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./shell/Layout";
import HomeScreen from "./screens/home/HomeScreen";
import SetEditorScreen from "./screens/set-editor/SetEditorScreen";
import MatrixScreen from "./screens/matrix/MatrixScreen";
import CompareScreen from "./screens/compare/CompareScreen";
import SettingsScreen from "./screens/settings/SettingsScreen";
import HelpScreen from "./screens/help/HelpScreen";
import ComparisonSettingsScreen from "./screens/comparison-settings/ComparisonSettingsScreen";
import ArchiveScreen from "./screens/archive/ArchiveScreen";

/**
 * Route table for every build-#1 screen (03-ui-design.md §2). Each screen
 * lives in its own folder under src/screens/<name>/ so phase 2/3 agents
 * replace only that file:
 *
 *   S1 /                      Home                      (this phase)
 *   S2 /sets/:id              Set Editor                (phase 2 placeholder)
 *   S3 /matrix                Track-Playlist Matrix     (phase 2 placeholder)
 *   S5 /compare(/:slug)       Playlist Compare Tool     (phase 3 placeholder)
 *   S6 /settings              Settings                  (this phase)
 *   S7 /help                  Help / Reference          (this phase)
 *   S8 /comparison-settings   Comparison Settings       (phase 3 placeholder)
 *      /archive               Set archive view          (this phase)
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/sets/:id" element={<SetEditorScreen />} />
          <Route path="/matrix" element={<MatrixScreen />} />
          <Route path="/compare" element={<CompareScreen />} />
          <Route path="/compare/:slug" element={<CompareScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/help" element={<HelpScreen />} />
          <Route
            path="/comparison-settings"
            element={<ComparisonSettingsScreen />}
          />
          <Route path="/archive" element={<ArchiveScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
