// Entry point. Starts the HTTP server (api/server.go) on port 8080.
package main

import (
	"log"
	"os"
	"strconv"
	_ "time/tzdata" // TABLE_TIMEZONE must resolve inside the minimal container image

	"github.com/rizzwareengineer/no-LLMit/engine/api"
)

func main() {
	port := 8080
	if portStr := os.Getenv("PORT"); portStr != "" {
		if p, err := strconv.Atoi(portStr); err == nil {
			port = p
		}
	}

	if err := (&api.Server{}).Start(port); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
