async def load_metadata(self):
        if self.broadcast:
            self.broadcast({
                "type": "metadata",
                "show_name": "Allen & Heath SQ",
                "snapshots": [{"id": i, "name": f"Scene {i}"} for i in range(1, 301)],
                "banks": [
                    {"id": "1-12", "name": "CH 1-12", "channels": [{"id": f"ch/{i}", "name": f"CH {i}"} for i in range(1, 13)]},
                    {"id": "13-24", "name": "CH 13-24", "channels": [{"id": f"ch/{i}", "name": f"CH {i}"} for i in range(13, 25)]},
                    {"id": "25-36", "name": "CH 25-36", "channels": [{"id": f"ch/{i}", "name": f"CH {i}"} for i in range(25, 37)]},
                    {"id": "37-48", "name": "CH 37-48", "channels": [{"id": f"ch/{i}", "name": f"CH {i}"} for i in range(37, 49)]},
                    {"id": "master", "name": "GRP / AUX / MAIN", "channels": [
                        {"id": "grp/1", "name": "GRP 1-2"}, {"id": "aux/1", "name": "AUX 1"},
                        {"id": "aux/2", "name": "AUX 2"}, {"id": "main/1", "name": "MAIN L/R"}
                    ]}
                ]
            })