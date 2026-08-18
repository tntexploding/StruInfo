# StruInfo 候选应用制品边界

- 状态：切片 0 已实现的非容器制品审计
- 最近更新：2026-08-11
- 对应决策：[ADR 0006](adr/0006-external-configuration-and-personal-data-isolation.md)

## 1. 目的与边界

`package.json` 的 `files` 是当前候选应用制品的闭合输入清单。
`corepack pnpm run artifact:verify` 使用锁定的 pnpm 执行 `pack --dry-run --json`，审计包管理器实际选择的文件，而不是自行猜测 `.gitignore` 或 npm 打包规则。

当前候选内容只包括：

- 编译后的服务端模块、迁移和服务端 package manifest；
- Vite 生成的前端 HTML、JavaScript、CSS、项目原创 favicon 和前端 package manifest；
- 版本化 OpenAPI、JSON Schema 和 contracts package manifest；
- README、第三方声明、npm 依赖许可证材料和 npm SPDX SBOM。

源码测试、`test_support`、运行配置、`.env`、秘密、工作区数据、Blob、上传、快照、导出、备份和任意未声明静态文件都不是候选包输入。

这不是发布授权或可部署包声明。
项目许可证仍未选择，生产依赖装配与容器镜像也未冻结；不得发布当前候选 tarball。

## 2. 审计行为

完整构建先使用 TypeScript build clean 清除陈旧编译输出，再生成服务端和前端文件。
制品审计随后：

1. 读取 pnpm 实际枚举的相对文件列表；
2. 拒绝绝对路径、反斜杠、遍历、重复路径、链接和非普通文件；
3. 只接受声明的目录、文件类型和必需入口；
4. 拒绝测试文件、`.tsbuildinfo`、环境文件和个人数据目录名；
5. 对候选程序与契约文本检查完整私钥块、带口令数据库 URL、秘密赋值和 Windows 用户目录等高置信风险；
6. 对每个文件记录字节数和 SHA-256；
7. 把排序后的确定性清单写入忽略区 `build/application-artifact-manifest.json`。

当前审计预算为单文件 16 MiB、候选内容总计 128 MiB。
这些是制品审计的通用安全上限，不是用户知识或 Blob 上限。

路径白名单是主要保证；文本检查只是事故防护，不能证明任意自然语言都不包含私人信息。
代码审查、合成 fixture 规则和禁止硬编码个人数据的工程规范仍然有效。

## 3. 容器与后续发布

仓库当前没有已准入的 Dockerfile 或生产镜像，因此本门不伪造镜像 digest 或镜像文件清单。
`M0-S-CONTAINER-MAINT-001` 接受具体基础镜像、生产依赖装配和 Dockerfile 后，镜像审计必须：

- 枚举最终镜像所有层与文件；
- 证明候选应用文件来自本清单或另一份经审查的声明；
- 证明运行配置、数据根和秘密只通过外部挂载或注入提供；
- 记录镜像 digest、基础镜像许可证和完整运行时 notices。

容器门未通过不否定当前非容器包边界，但任何文档都不能把本结果描述为生产镜像已经通过。

## 4. 验证命令

完整本地门包含构建与制品审计：

```powershell
corepack pnpm run verify
```

已有新鲜构建输出时可以单独复查：

```powershell
corepack pnpm run artifact:verify
```
