# Codex Quota Web

一个极简的 Codex 额度展示页。服务端读取本机 `~/.codex/auth.json`，请求 Codex 额度接口，然后只把脱敏后的剩余百分比和重置时间暴露给网页。

## 启动

```bash
npm start
```

默认地址：

```text
http://localhost:8787
```

## 配置

- `PORT`：服务端口，默认 `8787`
- `CACHE_MS`：额度接口缓存时间，默认 `45000`

示例：

```bash
PORT=9000 CACHE_MS=60000 npm start
```

## 注意

这个服务会在服务端读取并必要时刷新 `~/.codex/auth.json`。不要把这个文件、access token、refresh token 或服务端源码里的运行日志暴露到前端。

公开访问页面只会看到：

- 用户显示名和头像
- 5 小时额度剩余百分比
- 周额度剩余百分比
- 两个额度窗口的重置时间
- 更新时间
