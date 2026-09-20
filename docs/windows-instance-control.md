# Windows 独立实例控制

本入口控制已经部署的单用户 `all` 应用容器及其专用 PostgreSQL 容器。
把两个脚本复制到外部运维目录后，日常启停只需要 Windows PowerShell 5.1 和 Docker CLI，
不依赖 Codex、Node、pnpm、源码工作区或 Compose 文件。
首次创建容器、迁移、升级和备份仍遵守[生产运维流程](production-operations.md)。

## 安装与配置

1. 将 `deploy/windows/instance-control.ps1` 和 `instance-control.cmd` 复制到仓库外的启动器目录。
2. 将 `instance-control.example.json` 复制到独立的外部配置目录，填写已有实例的准确容器名、Docker context 和本机地址。
3. 把桌面快捷方式指向外部 `.cmd`，在参数中指定外部配置文件。

示例仅使用占位值，不能直接控制实际实例：

```json
{
  "schemaVersion": 1,
  "dockerContext": "example-local-context",
  "appContainer": "example-app",
  "databaseContainer": "example-database",
  "url": "http://127.0.0.1:3000/",
  "stateFile": "D:\\external\\operations\\control-state.json",
  "operationMutexName": "Local\\Example-StruInfo-operations",
  "dockerDesktopPath": null,
  "startupTimeoutSeconds": 120
}
```

`dockerContext` 必须是现有、连接本机 Windows named pipe 的 context，每次操作显式使用它。
可用 `docker context ls` 查看名称；切换默认 context 不会改变启动器目标。
`databaseContainer` 必须是此实例的专用数据库，不能填其他项目共享的容器。
`url` 只接受 HTTP(S) 回环 origin，实际端口以容器已发布的地址为准。
配置与状态文件必须在 Git 工作区外，也不能通过符号链接或 junction 指向其他目录。
真实配置、容器名、路径、快捷方式和状态文件不进入 Git 或应用制品。

`dockerDesktopPath` 可选；填写实际安装的 `Docker Desktop.exe` 绝对路径后，
Start 可在引擎尚未运行时通过隐藏窗口启动它并等待就绪。
不配置时应先手动打开 Docker Desktop。Stop、Status 和 Open 不会启动 Docker Desktop。
每个就绪阶段的超时由 `startupTimeoutSeconds` 控制，默认 120 秒，允许 5–300 秒。
Docker CLI 也有独立期限：普通命令使用该配置，停止命令为 35 秒。超时只结束本次 CLI；
Docker daemon 可能仍在执行请求，应通过 Status 核验实际状态后再操作。

## 日常操作

```powershell
& 'D:\external\launcher\instance-control.cmd' Menu -ConfigPath 'D:\external\config\instance.json'
& 'D:\external\launcher\instance-control.cmd' Start -ConfigPath 'D:\external\config\instance.json' -OpenBrowser
& 'D:\external\launcher\instance-control.cmd' Stop -ConfigPath 'D:\external\config\instance.json'
& 'D:\external\launcher\instance-control.cmd' Status -ConfigPath 'D:\external\config\instance.json'
& 'D:\external\launcher\instance-control.cmd' Open -ConfigPath 'D:\external\config\instance.json'
```

桌面“启动”快捷方式使用 `Start ... -OpenBrowser`，“停止”使用 `Stop ...`，
“控制台”使用 `Menu ...`。也可将 `STRUIINFO_INSTANCE_CONFIG` 设为配置文件的外部绝对路径，
此后不再传 `-ConfigPath`，直接双击 `.cmd` 即打开菜单。
Start 本身不打开浏览器，`-OpenBrowser` 或菜单的启动操作会在就绪后打开浏览器。

启动先检查两个容器均存在，再启动数据库，等待其健康状态与 `pg_isready`，最后启动应用。
应用必须通过容器健康检查（如果配置了该检查）及 `/health/ready` 的 StruInfo `all` 角色应答。
重复启动不会重建容器。停止先给应用 30 秒优雅退出窗口，确认退出后再停止数据库；
应用停止失败时保留数据库运行。重复停止也可安全执行。
脚本不关闭 Docker Desktop，不调用 `down`，不创建或删除容器，不删除卷或数据。

失败返回非零退出码并显示原因；`.cmd` 在失败时保留窗口。
已成功完成的前半段不会伪装成回滚：例如应用启动失败时，数据库可能已经运行；
状态命令显示实际容器状态，可解决问题后再次启动。
不要手动结束启动器窗口来模拟 Stop，应使用明确的停止入口。

## 与巡检及备份协调

`operationMutexName` 必须与该实例的外部巡检、备份使用同一 Windows `Local` mutex。
一个操作持有锁时，另一个启动器操作立即提示正在维护，不会穿插启停。
这是同一登录会话的协调接口；其他 Windows 用户或会话的服务需要另行统一协调。

停止在容器操作前原子写入 `stateFile`，成功启动并验证健康后写入 `running`：

```json
{
  "schemaVersion": 1,
  "desiredState": "stopped",
  "requestedAtUtc": "2040-01-01T00:00:00.0000000Z"
}
```

`desiredState` 只接受 `stopped` 或 `running`，表示用户要求，不能代替实际容器状态。
停止失败仍保留 `stopped` 意图；启动失败不会清除既有的停止意图。
外部巡检必须取得相同锁后再读此文件；`stopped` 时跳过常规可用性告警和备份，
更不能因备份或恢复服务逻辑重新启动实例。没有状态文件按旧巡检行为处理；
格式错误应报告配置问题，不能当作 `running`。
本通用脚本不安装或修改任何巡检任务，接线由部署时完成。

## 聚焦验证

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/verify_instance_control.ps1
```

合成替身覆盖指定容器与 context、启动/停止顺序、重复操作、失败后保留真实状态、
就绪超时、隐藏启动 Docker Desktop、外部配置校验和 Git 路径拒绝。
它不会调用实际 Docker、访问网络或读取真实工作区资料。
安装到真实外部实例后的健康与启停验收应单独记录，不能用合成检查代替。
