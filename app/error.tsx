'use client';
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="error-page">
      <h1>暂时无法打开订阅空间</h1>
      <p>请重试；如果仍然失败，请检查服务器数据库连接。</p>
      <button className="button primary" onClick={reset}>
        重新加载
      </button>
      <a className="button" href="/login">
        返回登录
      </a>
    </main>
  );
}
