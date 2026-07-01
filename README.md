# Codex Quota Web

一个轻量的 Codex 额度卡片页。服务端读取本机 `~/.codex/auth.json`，拉取 Codex 额度后，只把展示所需的用户信息、剩余额度和重置时间返回给前端。

![额度面板](docs/images/quota-dashboard.png)

![额度卡片背面](docs/images/quota-card-back.png)

## 重要功能

- 展示 5 小时额度和周额度的剩余百分比
- 显示额度重置时间和最近更新时间
- 支持头像、套餐标识、卡片翻面和背面额度铭文
- 支持卡片倾斜、周期扫光和进度条流光动画
- 点击或键盘操作进度条可临时显示重置倒计时
- 服务端定时刷新额度缓存，前端无需接触 token

## 启动

```bash
npm start
```

默认地址：

```text
http://localhost:8787
```

可通过 `PORT` 修改端口：

```bash
PORT=9000 npm start
```

## 注意

这个服务会在服务端读取并必要时刷新 `~/.codex/auth.json`。不要把 `auth.json`、access token、refresh token 或服务端日志暴露到前端。

页面保留了空闲状态下的进度条流光和卡片扫光动画；如果需要低功耗展示，可以在系统中开启“减少动态效果”，页面会自动收敛动画时长。
