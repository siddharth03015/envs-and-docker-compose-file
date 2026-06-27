"use client";
import { useAuthModal } from "@/context/AuthModalContext";
import { useDraggable } from "@/hooks/useDraggable";
import { clearUser } from "@/lib/storage";
import { useState, useEffect } from "react";

export default function AuthModal() {
  const { isOpen, view, openModal, closeModal, login, register } = useAuthModal();
  const { position, isDragging, onPointerDown, onPointerMove, onPointerUp, dragRef } = useDraggable();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const msg = sessionStorage.getItem("authModalError");
  
    if (msg) {
      setError(msg);
      sessionStorage.removeItem("authModalError");
    }
  }, []);  
  
  if (!isOpen) return null;

  const handleSubmit = async () => {
    try {
      setError("");

      if (!username || !password) {
        setError("Please fill all fields");
        return;
      }

      setLoading(true);

      if (view === "login") {
        await login(username, password);
      } else {
        if (password !== confirmPassword) {
          setError("Passwords do not match");
          setLoading(false);
          return;
        }

        await register(username, password);
      }

      setUsername("");
      setPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      if (err.response?.status === 401) {
        setError("Invalid username or password");
      } else if (err.response?.status === 409) {
        setError("Username already exists");
      } else {
        setError("Something went wrong");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div 
        className="premium-modal" 
        onClick={(e) => e.stopPropagation()}
        ref={dragRef}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ 
          position: "relative",
          left: position.x,
          top: position.y,
          transition: isDragging ? "none" : "box-shadow 0.2s",
          boxShadow: isDragging ? "0 40px 80px rgba(0,0,0,0.9)" : "0 30px 60px -15px rgba(0, 0, 0, 0.8)",
          zIndex: isDragging ? 2 : 1
        }}
      >
        <div 
          className="premium-modal-header"
          onPointerDown={onPointerDown}
          style={{ cursor: isDragging ? "grabbing" : "grab", userSelect: "none" }}
        >
          <div className="modal-title">
            <div className="brand-dot"></div>
            {view === "login" ? "Secure Login" : "Create Account"}
          </div>
          <button className="modal-close-btn" onClick={closeModal}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        
        <div className="premium-modal-body">
          <div className="premium-modal-tabs">
            <div 
              className={`premium-tab ${view === "login" ? "premium-tab-active" : "premium-tab-inactive"}`}
              onClick={() => {
                setError("");
                openModal("login");
              }}
            >
              Login
            </div>
            <div 
              className={`premium-tab ${view === "register" ? "premium-tab-active" : "premium-tab-inactive"}`}
              onClick={() => {
                setError("");
                openModal("register");
              }}
            >
              Register
            </div>
          </div>

          <div className="premium-form-fields">
            {view === "login" ? (
              <>
                <div className="premium-input-group">
                  <div className="input-label">Username</div>
                  <input
										className="input-minimal premium-input"
										placeholder="satoshi_99"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
                <div className="premium-input-group">
                  <div className="input-label">Password</div>
                  <input
                    type="password"
										className="input-minimal premium-input"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="premium-input-group">
                  <div className="input-label">Username</div>
                  <input
										className="input-minimal premium-input" 
										placeholder="satoshi_99"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>

                <div className="premium-input-group">
                  <div className="input-label">Password</div>
                  <input
                    type="password"
										className="input-minimal premium-input"
										placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>

                <div className="premium-input-group">
                  <div className="input-label">Confirm Password</div>
                  <input
                    type="password"
										className="input-minimal premium-input"
										placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>

          {error && (
            <div style={{ color: "red", marginBottom: "10px", fontSize: "13px" }}>
              {error}
            </div>
          )}

          <button className="premium-submit-btn" onClick={handleSubmit}>
            {loading
              ? "Processing..."
              : view === "login"
              ? "Authenticate"
              : "Create Account"}
          </button>
        </div>
      </div>
    </div>
  );
}
