async def load_metadata(self):
        if self.broadcast:
            self.broadcast({
                "type": "metadata",
                "show_name": "Allen & Heath dLive C3500",
                "snapshots": [{"id": i, "name": f"Scene {i}"} for i in range(1, 251)],
                "banks": [
                    {"id": "1-12", "name": "CH 1-12", "channels": [{"id": f"ch/{i}", "name": f"CH {i}"} for i in range(1, 13)]},
                    {"id": "13-24", "name": "CH 13-24", "channels": [{"id": f"ch/{i}", "name": f"CH {i}"} for i in range(13, 25)]},
                    {"id": "dca", "name": "DCA 1-8 & MAIN", "channels": [
                        *[{"id": f"dca/{i}", "name": f"DCA {i}"} for i in range(1, 9)],
                        {"id": "main/1", "name": "MAIN L/R"}
                    ]}
                ]
            })