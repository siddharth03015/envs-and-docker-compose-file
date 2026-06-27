"use client";
import { useShortcutsModal } from "@/context/ShortcutsModalContext";

const KEYBOARD_SHORTCUTS = [
  {
    category: "Navigation",
    shortcuts: [
      { keys: "G + D", description: "Dashboard" },
      { keys: "G + T", description: "Trade" },
      { keys: "G + P", description: "Portfolio" },
      { keys: "G + O", description: "Orders" },
    ],
  },
  {
    category: "Trading",
    shortcuts: [
      { keys: "B", description: "Buy" },
      { keys: "S", description: "Sell" },
    ],
  },
  {
    category: "Chart",
    shortcuts: [
      { keys: "F", description: "Fullscreen" },
      { keys: "Alt + Z", description: "Undo split" },
    ],
  },
  {
    category: "General",
    shortcuts: [
      { keys: "Shift + D", description: "Toggle theme" },
      { keys: "1–9", description: "Switch symbols" },
      { keys: "Esc", description: "Exit / Close" },
      { keys: "?", description: "Show shortcuts" },
    ],
  },
];

export default function ShortcutsModal() {
  const { isOpen, closeModal } = useShortcutsModal();

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div
        className="premium-modal shortcuts-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "540px" }}
      >
        <div className="premium-modal-header">
          <div className="modal-title">
            <div className="brand-dot"></div>
            Keyboard Shortcuts
          </div>
          <button className="modal-close-btn" onClick={closeModal}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className="premium-modal-body">
          <div className="shortcuts-grid">
            {KEYBOARD_SHORTCUTS.map((group) => (
              <div key={group.category} className="shortcuts-group">
                <div className="shortcuts-group-title">{group.category}</div>
                <div className="shortcuts-list">
                  {group.shortcuts.map((shortcut) => (
                    <div key={shortcut.keys} className="shortcut-row">
                      <kbd className="shortcut-keys">{shortcut.keys}</kbd>
                      <span className="shortcut-description">{shortcut.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
