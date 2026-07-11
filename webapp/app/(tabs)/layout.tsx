import BottomNavHost from '@/components/BottomNavHost';

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fx-main" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="fx-top-spacer" style={{ height: 'max(env(safe-area-inset-top), 8px)', flexShrink: 0 }} />
      <div className="fx-scroll" style={{ flex: 1, overflowY: 'auto' }}>
        {children}
        <div style={{ height: 96 }} />
      </div>
      <BottomNavHost />
    </div>
  );
}
