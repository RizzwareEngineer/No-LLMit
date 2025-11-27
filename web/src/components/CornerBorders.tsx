export default function CornerBorders() {
  // Brutalist space gray corner marks
  return (    
    <>  
      {/* Top-left */}
      <div className="absolute -top-[2px] -left-[2px] w-4 h-[2px] bg-gray-700" />
      <div className="absolute -top-[2px] -left-[2px] w-[2px] h-4 bg-gray-700" />
      
      {/* Top-right */}
      <div className="absolute -top-[2px] -right-[2px] w-4 h-[2px] bg-gray-700" />
      <div className="absolute -top-[2px] -right-[2px] w-[2px] h-4 bg-gray-700" />
      
      {/* Bottom-left */}
      <div className="absolute -bottom-[2px] -left-[2px] w-4 h-[2px] bg-gray-700" />
      <div className="absolute -bottom-[2px] -left-[2px] w-[2px] h-4 bg-gray-700" />
      
      {/* Bottom-right */}
      <div className="absolute -bottom-[2px] -right-[2px] w-4 h-[2px] bg-gray-700" />
      <div className="absolute -bottom-[2px] -right-[2px] w-[2px] h-4 bg-gray-700" />
    </>
  );
}

