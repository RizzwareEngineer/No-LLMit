// Entry point. Starts the WebSocket server (api/server.go) on port 8080.
package main

import (
	"log"
	"os"
	"strconv"

	"github.com/rizzwareengineer/no-LLMit/engine/api"
)

func main() {
	port := 8080
	if portStr := os.Getenv("PORT"); portStr != "" {
		if p, err := strconv.Atoi(portStr); err == nil {
			port = p
		}
	}

	log.Println("=================================")
	log.Println("           No-LLMit")
	log.Println("=================================")
	log.Printf("Starting server on port %d...", port)
	log.Println("")
	log.Println("WebSocket endpoint: ws://localhost:" + strconv.Itoa(port) + "/ws")
	log.Println("Health check: http://localhost:" + strconv.Itoa(port) + "/health")
	log.Println("")

	server := api.NewServer()
	if err := server.Start(port); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
