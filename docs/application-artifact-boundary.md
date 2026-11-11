# 发行包内容

package.json 的 files 字段声明分发范围。
artifact:verify 使用包管理器实际选出的文件进行检查。

发行包包含：

- 编译后的服务端、迁移、静态页面和协议文件。
- 包清单、README、MIT 许可证。
- 第三方声明、对应许可证和 SBOM。

原文、配置、密钥、备份、测试夹具和技术历史归档留在发行包外。
依赖版本由清单和锁文件确定。
构建与发布命令见[贡献指南](../CONTRIBUTING.md)，依赖材料见[依赖记录](dependencies/README.md)。
