import BottomNavHost from '@/components/BottomNavHost';

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 'max(env(safe-area-inset-top), 8px)', flexShrink: 0 }} />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {children}
        <div style={{ height: 96 }} />
      </div>
      <BottomNavHost />
    </div>
  );
}
