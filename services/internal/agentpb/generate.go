// Package agentpb holds the Go code generated from agent.proto, the protocol
// between cryptex-agent, the agent relay and approving devices.
package agentpb

// Needs protoc and protoc-gen-go v1.36.12 on PATH:
//   go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.12
//go:generate protoc --proto_path=../../../packages/vault-core/src/proto --go_out=. --go_opt=paths=source_relative agent.proto
